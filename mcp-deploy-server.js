#!/usr/bin/env node

/**
 * MCP Deploy Server - Simple static website deployment
 * Copyright (c) 2024 Eyevinn Technology AB
 * Licensed under the MIT License
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { Context } = require('@osaas/client-core');
const { getMinioMinioInstance, createMinioMinioInstance } = require('@osaas/client-services');
const Minio = require('minio');

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
    
    console.error(`🚀 Starting deployment for app: ${app_name}, build_dir: ${build_dir}`);
    
    // Validate build directory exists
    const buildPath = path.resolve(build_dir);
    if (!await fs.pathExists(buildPath)) {
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
        await minioClient.setBucketPolicy(bucketName, JSON.stringify(bucketPolicy));
        console.error(`Bucket "${bucketName}" policy set for anonymous read access`);
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
      console.error(`All files from "${buildPath}" uploaded to bucket "${bucketName}"`);
      const publicUrl = new URL(bucketName, minioInstance.url);
      const deploymentUrl = publicUrl.toString();
      const result = {
        url: deploymentUrl,
        platform: 'Open Source Cloud',
        buildDir: buildPath,
        message: 'Deployment completed successfully'
      }

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