# Deployment Tools

This project includes MCP deployment tools for deploying applications to Open Source Cloud.

## Available Deployment Tools

### 1. Static Website Deployment (`deploy_static_website`)

Deploys static websites to Open Source Cloud storage.

**Parameters:**
- `build_dir` (required): Directory containing built static files
- `app_name` (required): Name of the application

**Usage:**
```javascript
// Deploy a static website built in ./dist
await deployStaticWebsite({
  build_dir: './dist',
  app_name: 'my-website'
});
```

### 2. Node.js App Deployment to Web Runner (`deploy_node_app_to_webrunner`)

Deploys Node.js applications to Web Runner service by packaging code into a zip file and uploading to MinIO.

**Parameters:**
- `source_dir` (required): Directory containing the Node.js application source code
- `app_name` (required): Name of the application (must be alphanumeric)
- `github_token` (optional): GitHub token for private repository access
- `osc_access_token` (optional): OSC access token

**Usage:**
```javascript
// Deploy a Node.js application
await deployNodeAppToWebRunner({
  source_dir: './my-node-app',
  app_name: 'mynodeapp',
  github_token: 'ghp_xxxxxxxxxxxx', // optional
  osc_access_token: 'osc_xxxxxxxxxxxx' // optional
});
```

## How Web Runner Deployment Works

1. **Validation**: Validates that the source directory exists and app name is alphanumeric
2. **MinIO Setup**: Creates or reuses a MinIO instance for file storage
3. **Zip Creation**: Packages the entire source directory into a zip file
4. **Upload**: Uploads the zip file to MinIO with public read access
5. **S3 Configuration**: Configures Web Runner with S3-style URL and MinIO endpoint credentials
6. **Web Runner Creation**: Creates a Web Runner instance configured to download and run the application from the S3-compatible MinIO storage
7. **Cleanup**: Removes temporary files

## Requirements

- Node.js application must have a `package.json` file
- Application should expose a web server (typically on port from `process.env.PORT`)
- Dependencies will be installed automatically by Web Runner
- App name must contain only letters and numbers

## Example Node.js Application Structure

```
my-node-app/
├── package.json          # Required - defines dependencies and start script
├── server.js            # Main application file
├── public/              # Optional - static assets
│   ├── index.html
│   └── style.css
└── ...                  # Other application files
```

## Environment Variables Available in Web Runner

Your Node.js application can access these environment variables:
- `PORT`: The port your application should listen on
- `NODE_ENV`: Set to 'production'
- Other custom environment variables as configured

## Deployment Result

The deployment returns information including:
- `webRunnerUrl`: URL to the Web Runner instance management
- `appUrl`: Direct URL to access your running application
- `instanceName`: Name of the created Web Runner instance
- `sourceZipS3Url`: S3-style URL used by Web Runner to access the zip file (e.g., `s3://mybucket/myapp.zip`)
- `sourceZipHttpUrl`: Public HTTP URL to the uploaded source code zip file
- `s3EndpointUrl`: MinIO endpoint URL used for S3 access
- `platform`: Always "Open Source Cloud Web Runner"
- `message`: Deployment status message