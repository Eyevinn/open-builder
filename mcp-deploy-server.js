#!/usr/bin/env node

/**
 * MCP Deploy Server - Simple static website deployment
 * Copyright (c) 2024 Eyevinn Technology AB
 * Licensed under the MIT License
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StdioServerTransport
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { Context } = require('@osaas/client-core');
const {
  getMinioMinioInstance,
  createMinioMinioInstance,
  createEyevinnWebRunnerInstance,
  getEyevinnWebRunnerInstance
} = require('@osaas/client-services');
const Minio = require('minio');
const archiver = require('archiver');

class DeployMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'deploy-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.error('🔧 Listing available tools');
      return {
        tools: [
          {
            name: 'deploy_static_website',
            description: 'Deploy static website to Open Source Cloud storage',
            inputSchema: {
              type: 'object',
              properties: {
                build_dir: {
                  type: 'string',
                  description: 'Directory containing built static files'
                },
                app_name: {
                  type: 'string',
                  description: 'Name of the application'
                }
              },
              required: ['build_dir', 'app_name']
            }
          },
          {
            name: 'deploy_node_app_to_webrunner',
            description:
              'Deploy Node.js application to Web Runner service by packaging code into zip file and uploading to MinIO',
            inputSchema: {
              type: 'object',
              properties: {
                source_dir: {
                  type: 'string',
                  description:
                    'Directory containing the Node.js application source code'
                },
                app_name: {
                  type: 'string',
                  description: 'Name of the application (must be alphanumeric)'
                },
                github_token: {
                  type: 'string',
                  description:
                    'GitHub token for private repository access (optional)'
                },
                osc_access_token: {
                  type: 'string',
                  description: 'OSC access token (optional)'
                }
              },
              required: ['source_dir', 'app_name']
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.error('🔧 Tool call received:', request.params);
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'deploy_static_website':
            return await this.deployStaticWebsite(args);
          case 'deploy_node_app_to_webrunner':
            return await this.deployNodeAppToWebRunner(args);
          default:
            return {
              content: [
                {
                  type: 'text',
                  text: `Unknown tool: ${name}`
                }
              ],
              isError: true
            };
        }
      } catch (error) {
        console.error('Tool execution error:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });
  }

  async deployStaticWebsite(args) {
    const { build_dir, app_name } = args;

    console.error(
      `🚀 Starting deployment for app: ${app_name}, build_dir: ${build_dir}`
    );

    // Validate build directory exists
    const buildPath = path.resolve(build_dir);
    if (!(await fs.pathExists(buildPath))) {
      throw new Error(`Build directory not found: ${buildPath}`);
    }

    try {
      const ctx = new Context();
      const bucketName = app_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const minioInstanceName = 'builder';

      let minioInstance = await getMinioMinioInstance(ctx, minioInstanceName);
      if (!minioInstance) {
        const rootPassword = Math.random().toString(36).substring(2, 12);
        minioInstance = await createMinioMinioInstance(ctx, {
          name: minioInstanceName,
          RootUser: 'admin',
          RootPassword: rootPassword
        });
      }
      console.error('Using Minio instance:', minioInstance);

      // Create bucket using minio SDK
      const minioClient = new Minio.Client({
        endPoint: new URL(minioInstance.url).hostname,
        accessKey: minioInstance.RootUser,
        secretKey: minioInstance.RootPassword
      });

      // Check if bucket exists, create if it doesn't
      const bucketExists = await minioClient.bucketExists(bucketName);
      if (!bucketExists) {
        await minioClient.makeBucket(bucketName);
        console.error(`Bucket "${bucketName}" created successfully`);
      } else {
        console.error(`Bucket "${bucketName}" already exists`);
      }

      // Set bucket policy for anonymous read access
      const bucketPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`]
          }
        ]
      };

      try {
        await minioClient.setBucketPolicy(
          bucketName,
          JSON.stringify(bucketPolicy)
        );
        console.error(
          `Bucket "${bucketName}" policy set for anonymous read access`
        );
      } catch (error) {
        console.error(`Warning: Could not set bucket policy: ${error.message}`);
      }

      // Upload all files from build directory to bucket
      const uploadFiles = async (dirPath, prefix = '') => {
        const items = await fs.readdir(dirPath);

        for (const item of items) {
          const itemPath = path.join(dirPath, item);
          const stat = await fs.stat(itemPath);

          if (stat.isDirectory()) {
            // Recursively upload subdirectories
            await uploadFiles(itemPath, prefix ? `${prefix}/${item}` : item);
          } else {
            // Upload file
            const objectName = prefix ? `${prefix}/${item}` : item;
            await minioClient.fPutObject(bucketName, objectName, itemPath);
            console.error(`Uploaded: ${objectName}`);
          }
        }
      };

      await uploadFiles(buildPath);
      console.error(
        `All files from "${buildPath}" uploaded to bucket "${bucketName}"`
      );
      const publicUrl = new URL(
        path.join(bucketName, 'index.html'),
        minioInstance.url
      );
      const deploymentUrl = publicUrl.toString();
      const result = {
        url: deploymentUrl,
        platform: 'Open Source Cloud',
        buildDir: buildPath,
        message: 'Deployment completed successfully'
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      console.error('Deployment error:', error);
      throw new Error(`Deployment failed: ${error.message}`);
    }
  }

  async deployNodeAppToWebRunner(args) {
    const { source_dir, app_name, github_token, osc_access_token } = args;

    console.error(
      `🚀 Starting Web Runner deployment for app: ${app_name}, source_dir: ${source_dir}`
    );

    // Validate source directory exists
    const sourcePath = path.resolve(source_dir);
    if (!(await fs.pathExists(sourcePath))) {
      throw new Error(`Source directory not found: ${sourcePath}`);
    }

    // Validate app_name is alphanumeric
    if (!/^[a-zA-Z0-9]+$/.test(app_name)) {
      throw new Error(
        'App name must be alphanumeric (letters and numbers only)'
      );
    }

    try {
      const ctx = new Context();
      const bucketName = app_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const minioInstanceName = 'builder';

      // Get or create MinIO instance
      let minioInstance = await getMinioMinioInstance(ctx, minioInstanceName);
      if (!minioInstance) {
        const rootPassword = Math.random().toString(36).substring(2, 12);
        minioInstance = await createMinioMinioInstance(ctx, {
          name: minioInstanceName,
          RootUser: 'admin',
          RootPassword: rootPassword
        });
      }
      console.error('Using MinIO instance:', minioInstance);

      // Create MinIO client
      const minioClient = new Minio.Client({
        endPoint: new URL(minioInstance.url).hostname,
        accessKey: minioInstance.RootUser,
        secretKey: minioInstance.RootPassword
      });

      // Check if bucket exists, create if it doesn't
      const bucketExists = await minioClient.bucketExists(bucketName);
      if (!bucketExists) {
        await minioClient.makeBucket(bucketName);
        console.error(`Bucket "${bucketName}" created successfully`);
      }

      // Set bucket policy for public read access
      const bucketPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`]
          }
        ]
      };

      try {
        await minioClient.setBucketPolicy(
          bucketName,
          JSON.stringify(bucketPolicy)
        );
        console.error(`Bucket "${bucketName}" policy set for public access`);
      } catch (error) {
        console.error(`Warning: Could not set bucket policy: ${error.message}`);
      }

      // Create zip file from source directory
      const zipFileName = `${app_name}-${Date.now()}.zip`;
      const zipFilePath = path.join('/tmp', zipFileName);

      console.error(`Creating zip file: ${zipFilePath}`);
      await this.createZipFromDirectory(sourcePath, zipFilePath);

      // Upload zip file to MinIO
      const zipObjectName = zipFileName;
      await minioClient.fPutObject(bucketName, zipObjectName, zipFilePath);
      console.error(`Zip file uploaded to MinIO: ${zipObjectName}`);

      // Generate S3-style URL for the zip file
      const s3StyleUrl = `s3://${bucketName}/${zipObjectName}`;
      console.error(`S3-style URL: ${s3StyleUrl}`);

      // Create Web Runner instance with S3 configuration
      const webRunnerConfig = {
        name: app_name,
        SourceUrl: s3StyleUrl,
        AwsAccessKeyId: minioInstance.RootUser,
        AwsSecretAccessKey: minioInstance.RootPassword,
        S3EndpointUrl: minioInstance.url
      };

      if (github_token) {
        webRunnerConfig.GitHubToken = github_token;
      }

      if (osc_access_token) {
        webRunnerConfig.OscAccessToken = osc_access_token;
      }

      console.error(
        'Creating Web Runner instance with config:',
        webRunnerConfig
      );
      const webRunnerInstance = await createEyevinnWebRunnerInstance(
        ctx,
        webRunnerConfig
      );

      // Clean up temporary zip file
      await fs.remove(zipFilePath);
      console.error('Temporary zip file cleaned up');

      // Generate public HTTP URL for reference
      const zipPublicUrl = new URL(
        path.join(bucketName, zipObjectName),
        minioInstance.url
      ).toString();

      const result = {
        webRunnerUrl: webRunnerInstance.url,
        appUrl: webRunnerInstance.resources?.app?.url || webRunnerInstance.url,
        instanceName: webRunnerInstance.name,
        sourceZipS3Url: s3StyleUrl,
        sourceZipHttpUrl: zipPublicUrl,
        s3EndpointUrl: minioInstance.url,
        platform: 'Open Source Cloud Web Runner',
        message: 'Node.js application deployed successfully to Web Runner'
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Web Runner deployment error:', error);
      throw new Error(`Web Runner deployment failed: ${error.message}`);
    }
  }

  async createZipFromDirectory(sourcePath, outputPath) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.error(`Zip file created: ${archive.pointer()} total bytes`);
        resolve();
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Add all files and directories from sourcePath
      archive.directory(sourcePath, false);

      archive.finalize();
    });
  }

  setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Deploy Server Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Deploy Server running on stdio');
  }
}

// Start the server
if (require.main === module) {
  const server = new DeployMCPServer();
  server.run().catch(console.error);
}

module.exports = DeployMCPServer;
