import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from 'zod';
import { LinearMCPClient } from '../services/linearClient';
import { serverPrompt } from './prompt';
import { resourceTemplates } from './templates';
import { 
  createIssueTool, 
  updateIssueTool, 
  searchIssuesTool, 
  getUserIssuesTool, 
  addCommentTool 
} from './tools';
import {
  CreateIssueArgsSchema,
  UpdateIssueArgsSchema,
  SearchIssuesArgsSchema,
  GetUserIssuesArgsSchema,
  AddCommentArgsSchema
} from '../schemas/validation';
import { LinearIssueResponse } from '../interfaces/linear';

export async function startServer() {
  try {
    dotenv.config();

    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error("LINEAR_API_KEY environment variable is required");
      process.exit(1);
    }

    console.error("Starting Linear MCP Server...");
    const linearClient = new LinearMCPClient(apiKey);

    const server = new Server(
      {
        name: "linear-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          prompts: {
            default: serverPrompt
          },
          resources: {
            templates: true,
            read: true
          },
          tools: {},
        },
      }
    );

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: await linearClient.listIssues()
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = new URL(request.params.uri);
      const path = uri.pathname.replace(/^\//, '');

      if (uri.protocol === 'linear-organization') {
        const organization = await linearClient.getOrganization();
        return {
          contents: [{
            uri: "linear-organization:",
            mimeType: "application/json",
            text: JSON.stringify(organization, null, 2)
          }]
        };
      }

      if (uri.protocol === 'linear-viewer') {
        const viewer = await linearClient.getViewer();
        return {
          contents: [{
            uri: "linear-viewer:",
            mimeType: "application/json",
            text: JSON.stringify(viewer, null, 2)
          }]
        };
      }

      if (uri.protocol === 'linear-issue:') {
        const issue = await linearClient.getIssue(path);
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(issue, null, 2)
          }]
        };
      }

      if (uri.protocol === 'linear-team:') {
        const [teamId] = path.split('/');
        const issues = await linearClient.getTeamIssues(teamId);
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(issues, null, 2)
          }]
        };
      }

      if (uri.protocol === 'linear-user:') {
        const [userId] = path.split('/');
        const issues = await linearClient.getUserIssues({
          userId: userId === 'me' ? undefined : userId
        });
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(issues, null, 2)
          }]
        };
      }

      throw new Error(`Unsupported resource URI: ${request.params.uri}`);
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [createIssueTool, updateIssueTool, searchIssuesTool, getUserIssuesTool, addCommentTool]
    }));

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return {
        resourceTemplates: resourceTemplates
      };
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [serverPrompt]
      };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === serverPrompt.name) {
        return {
          prompt: serverPrompt
        };
      }
      throw new Error(`Prompt not found: ${request.params.name}`);
    });

    server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      let metrics = linearClient.rateLimiter.getMetrics();

      try {
        const { name, arguments: args } = request.params;
        if (!args) throw new Error("Missing arguments");

        const baseResponse = {
          apiMetrics: {
            requestsInLastHour: metrics.requestsInLastHour,
            remainingRequests: linearClient.rateLimiter.requestsPerHour - metrics.requestsInLastHour,
            averageRequestTime: `${Math.round(metrics.averageRequestTime)}ms`,
            queueLength: metrics.queueLength
          }
        };

        switch (name) {
          case "linear_create_issue": {
            const validatedArgs = CreateIssueArgsSchema.parse(args);
            const issue = await linearClient.createIssue(validatedArgs);
            return {
              content: [{
                type: "text",
                text: `Created issue ${issue.identifier}: ${issue.title}\nURL: ${issue.url}`,
                metadata: baseResponse
              }]
            };
          }

          case "linear_update_issue": {
            const validatedArgs = UpdateIssueArgsSchema.parse(args);
            const issue = await linearClient.updateIssue(validatedArgs);
            return {
              content: [{
                type: "text",
                text: `Updated issue ${issue.identifier}\nURL: ${issue.url}`,
                metadata: baseResponse
              }]
            };
          }

          case "linear_search_issues": {
            const validatedArgs = SearchIssuesArgsSchema.parse(args);
            const issues = await linearClient.searchIssues(validatedArgs);
            return {
              content: [{
                type: "text",
                text: `Found ${issues.length} issues:\n${
                  issues.map((issue: LinearIssueResponse) =>
                    `- ${issue.identifier}: ${issue.title}\n  Priority: ${issue.priority || 'None'}\n  Status: ${issue.status || 'None'}\n  ${issue.url}`
                  ).join('\n')
                }`,
                metadata: baseResponse
              }]
            };
          }

          case "linear_get_user_issues": {
            const validatedArgs = GetUserIssuesArgsSchema.parse(args);
            const issues = await linearClient.getUserIssues(validatedArgs);

            return {
              content: [{
                type: "text",
                text: `Found ${issues.length} issues:\n${
                  issues.map((issue: LinearIssueResponse) =>
                    `- ${issue.identifier}: ${issue.title}\n  Priority: ${issue.priority || 'None'}\n  Status: ${issue.stateName}\n  ${issue.url}`
                  ).join('\n')
                }`,
                metadata: baseResponse
              }]
            };
          }

          case "linear_add_comment": {
            const validatedArgs = AddCommentArgsSchema.parse(args);
            const { comment, issue } = await linearClient.addComment(validatedArgs);

            return {
              content: [{
                type: "text",
                text: `Added comment to issue ${issue?.identifier}\nURL: ${comment.url}`,
                metadata: baseResponse
              }]
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error("Error executing tool:", error);

        const errorResponse = {
          apiMetrics: {
            requestsInLastHour: metrics.requestsInLastHour,
            remainingRequests: linearClient.rateLimiter.requestsPerHour - metrics.requestsInLastHour,
            averageRequestTime: `${Math.round(metrics.averageRequestTime)}ms`,
            queueLength: metrics.queueLength
          }
        };

        // If it's a Zod error, format it nicely
        if (error instanceof z.ZodError) {
          const formattedErrors = error.errors.map(err => ({
            path: err.path,
            message: err.message,
            code: 'VALIDATION_ERROR'
          }));
          
          return {
            content: [{
              type: "text",
              text: {
                error: {
                  type: 'VALIDATION_ERROR',
                  message: 'Invalid request parameters',
                  details: formattedErrors
                }
              },
              metadata: {
                error: true,
                ...errorResponse
              }
            }]
          };
        }

        // For Linear API errors, try to extract useful information
        if (error instanceof Error && 'response' in error) {
          return {
            content: [{
              type: "text",
              text: {
                error: {
                  type: 'API_ERROR',
                  message: error.message,
                  details: {
                    // @ts-ignore - response property exists but isn't in type
                    status: error.response?.status,
                    // @ts-ignore - response property exists but isn't in type
                    data: error.response?.data
                  }
                }
              },
              metadata: {
                error: true,
                ...errorResponse
              }
            }]
          };
        }

        // For all other errors
        return {
          content: [{
            type: "text",
            text: {
              error: {
                type: 'UNKNOWN_ERROR',
                message: error instanceof Error ? error.message : String(error)
              }
            },
            metadata: {
              error: true,
              ...errorResponse
            }
          }]
        };
      }
    });

    const transport = new StdioServerTransport();
    console.error("Connecting server to transport...");
    await server.connect(transport);
    console.error("Linear MCP Server running on stdio");
  } catch (error) {
    console.error(`Fatal error in startServer(): ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} 