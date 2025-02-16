#!/usr/bin/env node

import { LinearClient, LinearDocument, Issue, User, Team, WorkflowState, IssueLabel } from "@linear/sdk";
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
  Tool,
  ResourceTemplate,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

interface CreateIssueArgs {
  title: string;
  teamId: string;
  description?: string;
  priority?: number;
  status?: string;
  parentId?: string;
}

interface UpdateIssueArgs {
  id: string;
  title?: string;
  description?: string;
  priority?: number;
  status?: string;
}

interface SearchIssuesArgs {
  query?: string;
  teamId?: string;
  limit?: number;
  status?: string;
  assigneeId?: string;
  labels?: string[];
  priority?: number;
  estimate?: number;
  includeArchived?: boolean;
}

interface GetUserIssuesArgs {
  userId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface AddCommentArgs {
  issueId: string;
  body: string;
  createAsUser?: string;
  displayIconUrl?: string;
}

interface RateLimiterMetrics {
  totalRequests: number;
  requestsInLastHour: number;
  averageRequestTime: number;
  queueLength: number;
  lastRequestTime: number;
}

interface LinearIssueResponse {
  identifier: string;
  title: string;
  priority: number | null;
  status: string | null;
  stateName?: string;
  url: string;
}

class RateLimiter {
  public readonly requestsPerHour = 1400;
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private readonly minDelayMs = 3600000 / this.requestsPerHour;
  private requestTimes: number[] = [];
  private requestTimestamps: number[] = [];

  async enqueue<T>(fn: () => Promise<T>, operation?: string): Promise<T> {
    const startTime = Date.now();
    const queuePosition = this.queue.length;

    console.error(`[Linear API] Enqueueing request${operation ? ` for ${operation}` : ''} (Queue position: ${queuePosition})`);

    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          console.error(`[Linear API] Starting request${operation ? ` for ${operation}` : ''}`);
          const result = await fn();
          const endTime = Date.now();
          const duration = endTime - startTime;

          console.error(`[Linear API] Completed request${operation ? ` for ${operation}` : ''} (Duration: ${duration}ms)`);
          this.trackRequest(startTime, endTime, operation);
          resolve(result);
        } catch (error) {
          console.error(`[Linear API] Error in request${operation ? ` for ${operation}` : ''}: `, error);
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      const requestsInLastHour = this.requestTimestamps.filter(t => t > now - 3600000).length;
      if (requestsInLastHour >= this.requestsPerHour * 0.9 && timeSinceLastRequest < this.minDelayMs) {
        const waitTime = this.minDelayMs - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const fn = this.queue.shift();
      if (fn) {
        this.lastRequestTime = Date.now();
        await fn();
      }
    }

    this.processing = false;
  }

  async batch<T>(items: any[], batchSize: number, fn: (item: any) => Promise<T>, operation?: string): Promise<T[]> {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      batches.push(Promise.all(
        batch.map(item => this.enqueue(() => fn(item), operation))
      ));
    }

    const results = await Promise.all(batches);
    return results.flat();
  }

  private trackRequest(startTime: number, endTime: number, operation?: string) {
    const duration = endTime - startTime;
    this.requestTimes.push(duration);
    this.requestTimestamps.push(startTime);

    // Keep only last hour of requests
    const oneHourAgo = Date.now() - 3600000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneHourAgo);
    this.requestTimes = this.requestTimes.slice(-this.requestTimestamps.length);
  }

  getMetrics(): RateLimiterMetrics {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const recentRequests = this.requestTimestamps.filter(t => t > oneHourAgo);

    return {
      totalRequests: this.requestTimestamps.length,
      requestsInLastHour: recentRequests.length,
      averageRequestTime: this.requestTimes.length > 0
        ? this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length
        : 0,
      queueLength: this.queue.length,
      lastRequestTime: this.lastRequestTime
    };
  }
}

class LinearMCPClient {
  private client: LinearClient;
  public readonly rateLimiter: RateLimiter;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("LINEAR_API_KEY environment variable is required");
    this.client = new LinearClient({ apiKey });
    this.rateLimiter = new RateLimiter();
  }

  private async getIssueDetails(issue: Issue) {
    const [statePromise, assigneePromise, teamPromise] = [
      issue.state,
      issue.assignee,
      issue.team
    ];

    const [state, assignee, team] = await Promise.all([
      this.rateLimiter.enqueue(async () => statePromise ? await statePromise : null),
      this.rateLimiter.enqueue(async () => assigneePromise ? await assigneePromise : null),
      this.rateLimiter.enqueue(async () => teamPromise ? await teamPromise : null)
    ]);

    return {
      state,
      assignee,
      team
    };
  }

  private addMetricsToResponse(response: any) {
    const metrics = this.rateLimiter.getMetrics();
    return {
      ...response,
      metadata: {
        ...response.metadata,
        apiMetrics: {
          requestsInLastHour: metrics.requestsInLastHour,
          remainingRequests: this.rateLimiter.requestsPerHour - metrics.requestsInLastHour,
          averageRequestTime: `${Math.round(metrics.averageRequestTime)}ms`,
          queueLength: metrics.queueLength,
          lastRequestTime: new Date(metrics.lastRequestTime).toISOString()
        }
      }
    };
  }

  async listIssues() {
    const result = await this.rateLimiter.enqueue(
      () => this.client.issues({
        first: 50,
        orderBy: LinearDocument.PaginationOrderBy.UpdatedAt
      }),
      'listIssues'
    );

    const issuesWithDetails = await this.rateLimiter.batch(
      result.nodes,
      5,
      async (issue) => {
        const details = await this.getIssueDetails(issue);
        return {
          uri: `linear-issue:///${issue.id}`,
          mimeType: "application/json",
          name: issue.title,
          description: `Linear issue ${issue.identifier}: ${issue.title}`,
          metadata: {
            identifier: issue.identifier,
            priority: issue.priority,
            status: details.state ? await details.state.name : undefined,
            assignee: details.assignee ? await details.assignee.name : undefined,
            team: details.team ? await details.team.name : undefined,
          }
        };
      },
      'getIssueDetails'
    );

    return this.addMetricsToResponse(issuesWithDetails);
  }

  async getIssue(issueId: string) {
    const result = await this.rateLimiter.enqueue(() => this.client.issue(issueId));
    if (!result) throw new Error(`Issue ${issueId} not found`);

    const details = await this.getIssueDetails(result);

    return this.addMetricsToResponse({
      id: result.id,
      identifier: result.identifier,
      title: result.title,
      description: result.description,
      priority: result.priority,
      status: details.state?.name,
      assignee: details.assignee?.name,
      team: details.team?.name,
      url: result.url
    });
  }

  async createIssue(args: CreateIssueArgs) {
    const issuePayload = await this.client.createIssue({
      title: args.title,
      teamId: args.teamId,
      description: args.description,
      priority: args.priority,
      stateId: args.status,
      parentId: args.parentId
    });

    const issue = await issuePayload.issue;
    if (!issue) throw new Error("Failed to create issue");
    return issue;
  }

  async updateIssue(args: UpdateIssueArgs) {
    const issue = await this.client.issue(args.id);
    if (!issue) throw new Error(`Issue ${args.id} not found`);

    const updatePayload = await issue.update({
      title: args.title,
      description: args.description,
      priority: args.priority,
      stateId: args.status
    });

    const updatedIssue = await updatePayload.issue;
    if (!updatedIssue) throw new Error("Failed to update issue");
    return updatedIssue;
  }

  async searchIssues(args: SearchIssuesArgs) {
    const result = await this.rateLimiter.enqueue(() =>
      this.client.issues({
        filter: this.buildSearchFilter(args),
        first: args.limit || 10,
        includeArchived: args.includeArchived
      })
    );

    const issuesWithDetails = await this.rateLimiter.batch(result.nodes, 5, async (issue) => {
      const [state, assignee, labels] = await Promise.all([
        this.rateLimiter.enqueue(() => issue.state) as Promise<WorkflowState>,
        this.rateLimiter.enqueue(() => issue.assignee) as Promise<User>,
        this.rateLimiter.enqueue(() => issue.labels()) as Promise<{ nodes: IssueLabel[] }>
      ]);

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        estimate: issue.estimate,
        status: state?.name || null,
        assignee: assignee?.name || null,
        labels: labels?.nodes?.map((label: IssueLabel) => label.name) || [],
        url: issue.url
      };
    });

    return this.addMetricsToResponse(issuesWithDetails);
  }

  async getUserIssues(args: GetUserIssuesArgs) {
    try {
      const user = args.userId && typeof args.userId === 'string' ?
        await this.rateLimiter.enqueue(() => this.client.user(args.userId as string)) :
        await this.rateLimiter.enqueue(() => this.client.viewer);

      const result = await this.rateLimiter.enqueue(() => user.assignedIssues({
        first: args.limit || 50,
        includeArchived: args.includeArchived
      }));

      if (!result?.nodes) {
        return this.addMetricsToResponse([]);
      }

      const issuesWithDetails = await this.rateLimiter.batch(
        result.nodes,
        5,
        async (issue) => {
          const state = await this.rateLimiter.enqueue(() => issue.state) as WorkflowState;
          return {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            priority: issue.priority,
            stateName: state?.name || 'Unknown',
            url: issue.url
          };
        },
        'getUserIssues'
      );

      return this.addMetricsToResponse(issuesWithDetails);
    } catch (error) {
      console.error(`Error in getUserIssues: ${error}`);
      throw error;
    }
  }

  async addComment(args: AddCommentArgs) {
    const commentPayload = await this.client.createComment({
      issueId: args.issueId,
      body: args.body,
      createAsUser: args.createAsUser,
      displayIconUrl: args.displayIconUrl
    });

    const comment = await commentPayload.comment;
    if (!comment) throw new Error("Failed to create comment");

    const issue = await comment.issue;
    return {
      comment,
      issue
    };
  }

  async getTeamIssues(teamId: string) {
    const team = await this.rateLimiter.enqueue(() => this.client.team(teamId));
    if (!team) throw new Error(`Team ${teamId} not found`);

    const { nodes: issues } = await this.rateLimiter.enqueue(() => team.issues());

    const issuesWithDetails = await this.rateLimiter.batch(issues, 5, async (issue) => {
      const statePromise = issue.state;
      const assigneePromise = issue.assignee;

      const [state, assignee] = await Promise.all([
        this.rateLimiter.enqueue(async () => statePromise ? await statePromise : null),
        this.rateLimiter.enqueue(async () => assigneePromise ? await assigneePromise : null)
      ]);

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        status: state?.name,
        assignee: assignee?.name,
        url: issue.url
      };
    });

    return this.addMetricsToResponse(issuesWithDetails);
  }

  async getViewer() {
    const viewer = await this.client.viewer;
    const [teams, organization] = await Promise.all([
      viewer.teams(),
      this.client.organization
    ]);

    return this.addMetricsToResponse({
      id: viewer.id,
      name: viewer.name,
      email: viewer.email,
      admin: viewer.admin,
      teams: teams.nodes.map(team => ({
        id: team.id,
        name: team.name,
        key: team.key
      })),
      organization: {
        id: organization.id,
        name: organization.name,
        urlKey: organization.urlKey
      }
    });
  }

  async getOrganization() {
    const organization = await this.client.organization;
    const [teams, users] = await Promise.all([
      organization.teams(),
      organization.users()
    ]);

    return this.addMetricsToResponse({
      id: organization.id,
      name: organization.name,
      urlKey: organization.urlKey,
      teams: teams.nodes.map(team => ({
        id: team.id,
        name: team.name,
        key: team.key
      })),
      users: users.nodes.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        admin: user.admin,
        active: user.active
      }))
    });
  }

  private buildSearchFilter(args: SearchIssuesArgs): any {
    const filter: any = {};

    if (args.query) {
      filter.or = [
        { title: { contains: args.query } },
        { description: { contains: args.query } }
      ];
    }

    if (args.teamId) {
      filter.team = { id: { eq: args.teamId } };
    }

    if (args.status) {
      filter.state = { name: { eq: args.status } };
    }

    if (args.assigneeId) {
      filter.assignee = { id: { eq: args.assigneeId } };
    }

    if (args.labels && args.labels.length > 0) {
      filter.labels = {
        some: {
          name: { in: args.labels }
        }
      };
    }

    if (args.priority) {
      filter.priority = { eq: args.priority };
    }

    if (args.estimate) {
      filter.estimate = { eq: args.estimate };
    }

    return filter;
  }
}

const createIssueTool: Tool = {
  name: "linear_create_issue",
  description: "Creates a new Linear issue with specified details. Use this to create tickets for tasks, bugs, or feature requests. Returns the created issue's identifier and URL. Required fields are title and teamId, with optional description, priority (0-4, where 0 is no priority and 1 is urgent), status, and parentId for creating sub-issues.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Issue title" },
      teamId: { type: "string", description: "Team ID" },
      description: { type: "string", description: "Issue description" },
      priority: { type: "number", description: "Priority (0-4)" },
      status: { type: "string", description: "Issue status" },
      parentId: { type: "string", description: "Optional parent issue ID to create this as a sub-issue" }
    },
    required: ["title", "teamId"]
  }
};

const updateIssueTool: Tool = {
  name: "linear_update_issue",
  description: "Updates an existing Linear issue's properties. Use this to modify issue details like title, description, priority, or status. Requires the issue ID and accepts any combination of updatable fields. Returns the updated issue's identifier and URL.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Issue ID" },
      title: { type: "string", description: "New title" },
      description: { type: "string", description: "New description" },
      priority: { type: "number", description: "New priority (0-4)" },
      status: { type: "string", description: "New status" }
    },
    required: ["id"]
  }
};

const searchIssuesTool: Tool = {
  name: "linear_search_issues",
  description: "Searches Linear issues using flexible criteria. Supports filtering by any combination of: title/description text, team, status, assignee, labels, priority (1=urgent, 2=high, 3=normal, 4=low), and estimate. Returns up to 10 issues by default (configurable via limit).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional text to search in title and description" },
      teamId: { type: "string", description: "Filter by team ID" },
      status: { type: "string", description: "Filter by status name (e.g., 'In Progress', 'Done')" },
      assigneeId: { type: "string", description: "Filter by assignee's user ID" },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "Filter by label names"
      },
      priority: {
        type: "number",
        description: "Filter by priority (1=urgent, 2=high, 3=normal, 4=low)"
      },
      estimate: {
        type: "number",
        description: "Filter by estimate points"
      },
      includeArchived: {
        type: "boolean",
        description: "Include archived issues in results (default: false)"
      },
      limit: {
        type: "number",
        description: "Max results to return (default: 10)"
      }
    }
  }
};

const getUserIssuesTool: Tool = {
  name: "linear_get_user_issues",
  description: "Retrieves issues assigned to a specific user or the authenticated user if no userId is provided. Returns issues sorted by last updated, including priority, status, and other metadata. Useful for finding a user's workload or tracking assigned tasks.",
  inputSchema: {
    type: "object",
    properties: {
      userId: { type: "string", description: "Optional user ID. If not provided, returns authenticated user's issues" },
      includeArchived: { type: "boolean", description: "Include archived issues in results" },
      limit: { type: "number", description: "Maximum number of issues to return (default: 50)" }
    }
  }
};

const addCommentTool: Tool = {
  name: "linear_add_comment",
  description: "Adds a comment to an existing Linear issue. Supports markdown formatting in the comment body. Can optionally specify a custom user name and avatar for the comment. Returns the created comment's details including its URL.",
  inputSchema: {
    type: "object",
    properties: {
      issueId: { type: "string", description: "ID of the issue to comment on" },
      body: { type: "string", description: "Comment text in markdown format" },
      createAsUser: { type: "string", description: "Optional custom username to show for the comment" },
      displayIconUrl: { type: "string", description: "Optional avatar URL for the comment" }
    },
    required: ["issueId", "body"]
  }
};

const resourceTemplates: ResourceTemplate[] = [
  {
    uriTemplate: "linear-issue:///{issueId}",
    name: "Linear Issue",
    description: "A Linear issue with its details, comments, and metadata. Use this to fetch detailed information about a specific issue.",
    parameters: {
      issueId: {
        type: "string",
        description: "The unique identifier of the Linear issue (e.g., the internal ID)"
      }
    },
    examples: [
      "linear-issue:///c2b318fb-95d2-4a81-9539-f3268f34af87"
    ]
  },
  {
    uriTemplate: "linear-viewer:",
    name: "Current User",
    description: "Information about the authenticated user associated with the API key, including their role, teams, and settings.",
    parameters: {},
    examples: [
      "linear-viewer:"
    ]
  },
  {
    uriTemplate: "linear-organization:",
    name: "Current Organization",
    description: "Details about the Linear organization associated with the API key, including settings, teams, and members.",
    parameters: {},
    examples: [
      "linear-organization:"
    ]
  },
  {
    uriTemplate: "linear-team:///{teamId}/issues",
    name: "Team Issues",
    description: "All active issues belonging to a specific Linear team, including their status, priority, and assignees.",
    parameters: {
      teamId: {
        type: "string",
        description: "The unique identifier of the Linear team (found in team settings)"
      }
    },
    examples: [
      "linear-team:///TEAM-123/issues"
    ]
  },
  {
    uriTemplate: "linear-user:///{userId}/assigned",
    name: "User Assigned Issues",
    description: "Active issues assigned to a specific Linear user. Returns issues sorted by update date.",
    parameters: {
      userId: {
        type: "string",
        description: "The unique identifier of the Linear user. Use 'me' for the authenticated user"
      }
    },
    examples: [
      "linear-user:///USER-123/assigned",
      "linear-user:///me/assigned"
    ]
  }
];

const serverPrompt: Prompt = {
  name: "linear-server-prompt",
  description: "Instructions for using the Linear MCP server effectively",
  instructions: `This server provides access to Linear, a project management tool. Use it to manage issues, track work, and coordinate with teams.

Key capabilities:
- Create and update issues: Create new tickets or modify existing ones with titles, descriptions, priorities, and team assignments.
- Search functionality: Find issues across the organization using flexible search queries with team and user filters.
- Team coordination: Access team-specific issues and manage work distribution within teams.
- Issue tracking: Add comments and track progress through status updates and assignments.
- Organization overview: View team structures and user assignments across the organization.

Tool Usage:
- linear_create_issue:
  - use teamId from linear-organization: resource
  - priority levels: 1=urgent, 2=high, 3=normal, 4=low
  - status must match exact Linear workflow state names (e.g., "In Progress", "Done")

- linear_update_issue:
  - get issue IDs from search_issues or linear-issue:/// resources
  - only include fields you want to change
  - status changes must use valid state IDs from the team's workflow

- linear_search_issues:
  - combine multiple filters for precise results
  - use labels array for multiple tag filtering
  - query searches both title and description
  - returns max 10 results by default

- linear_get_user_issues:
  - omit userId to get authenticated user's issues
  - useful for workload analysis and sprint planning
  - returns most recently updated issues first

- linear_add_comment:
  - supports full markdown formatting
  - use displayIconUrl for bot/integration avatars
  - createAsUser for custom comment attribution

Best practices:
- When creating issues:
  - Write clear, actionable titles that describe the task well (e.g., "Implement user authentication for mobile app")
  - Include concise but appropriately detailed descriptions in markdown format with context and acceptance criteria
  - Set appropriate priority based on the context (1=critical to 4=nice-to-have)
  - Always specify the correct team ID (default to the user's team if possible)

- When searching:
  - Use specific, targeted queries for better results (e.g., "auth mobile app" rather than just "auth")
  - Apply relevant filters when asked or when you can infer the appropriate filters to narrow results

- When adding comments:
  - Use markdown formatting to improve readability and structure
  - Keep content focused on the specific issue and relevant updates
  - Include action items or next steps when appropriate

- General best practices:
  - Fetch organization data first to get valid team IDs
  - Use search_issues to find issues for bulk operations
  - Include markdown formatting in descriptions and comments

Resource patterns:
- linear-issue:///{issueId} - Single issue details (e.g., linear-issue:///c2b318fb-95d2-4a81-9539-f3268f34af87)
- linear-team:///{teamId}/issues - Team's issue list (e.g., linear-team:///OPS/issues)
- linear-user:///{userId}/assigned - User assignments (e.g., linear-user:///USER-123/assigned)
- linear-organization: - Organization for the current user
- linear-viewer: - Current user context

The server uses the authenticated user's permissions for all operations.`
};

interface MCPMetricsResponse {
  apiMetrics: {
    requestsInLastHour: number;
    remainingRequests: number;
    averageRequestTime: string;
    queueLength: number;
  }
}

async function main() {
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
      let metrics: RateLimiterMetrics = {
        totalRequests: 0,
        requestsInLastHour: 0,
        averageRequestTime: 0,
        queueLength: 0,
        lastRequestTime: Date.now()
      };

      try {
        const { name, arguments: args } = request.params;
        if (!args) throw new Error("Missing arguments");

        metrics = linearClient.rateLimiter.getMetrics();

        const baseResponse: MCPMetricsResponse = {
          apiMetrics: {
            requestsInLastHour: metrics.requestsInLastHour,
            remainingRequests: linearClient.rateLimiter.requestsPerHour - metrics.requestsInLastHour,
            averageRequestTime: `${Math.round(metrics.averageRequestTime)}ms`,
            queueLength: metrics.queueLength
          }
        };

        switch (name) {
          case "linear_create_issue": {
            if (!args.title || !args.teamId) {
              throw new Error("Missing required fields: title and teamId");
            }

            const createArgs: CreateIssueArgs = {
              title: String(args.title),
              teamId: String(args.teamId),
              description: args.description ? String(args.description) : undefined,
              priority: args.priority ? Number(args.priority) : undefined,
              status: args.status ? String(args.status) : undefined,
              parentId: args.parentId ? String(args.parentId) : undefined
            };

            const issue = await linearClient.createIssue(createArgs);
            return {
              content: [{
                type: "text",
                text: `Created issue ${issue.identifier}: ${issue.title}\nURL: ${issue.url}`,
                metadata: baseResponse
              }]
            };
          }

          case "linear_update_issue": {
            if (!args.id) {
              throw new Error("Missing required field: id");
            }

            const updateArgs: UpdateIssueArgs = {
              id: String(args.id),
              title: args.title ? String(args.title) : undefined,
              description: args.description ? String(args.description) : undefined,
              priority: args.priority ? Number(args.priority) : undefined,
              status: args.status ? String(args.status) : undefined
            };

            const issue = await linearClient.updateIssue(updateArgs);
            return {
              content: [{
                type: "text",
                text: `Updated issue ${issue.identifier}\nURL: ${issue.url}`,
                metadata: baseResponse
              }]
            };
          }

          case "linear_search_issues": {
            const searchArgs: SearchIssuesArgs = {
              query: args.query ? String(args.query) : undefined,
              teamId: args.teamId ? String(args.teamId) : undefined,
              status: args.status ? String(args.status) : undefined,
              assigneeId: args.assigneeId ? String(args.assigneeId) : undefined,
              labels: args.labels ? (args.labels as string[]) : undefined,
              priority: args.priority ? Number(args.priority) : undefined,
              estimate: args.estimate ? Number(args.estimate) : undefined,
              includeArchived: args.includeArchived ? Boolean(args.includeArchived) : undefined,
              limit: args.limit ? Number(args.limit) : undefined
            };

            const issues = await linearClient.searchIssues(searchArgs);
            return {
              content: [{
                type: "text",
                text: `Found ${issues.length} issues:\n${issues.map((issue: LinearIssueResponse) =>
                  `- ${issue.identifier}: ${issue.title}\n  Priority: ${issue.priority || 'None'}\n  Status: ${issue.status || 'None'}\n  ${issue.url}`
                ).join('\n')
                  }`,
                metadata: baseResponse
              }]
            };
          }

          case "linear_get_user_issues": {
            const issues = await linearClient.getUserIssues({
              userId: args.userId ? String(args.userId) : undefined,
              includeArchived: args.includeArchived ? Boolean(args.includeArchived) : undefined,
              limit: args.limit ? Number(args.limit) : undefined
            });

            return {
              content: [{
                type: "text",
                text: `Found ${issues.length} issues:\n${issues.map((issue: LinearIssueResponse) =>
                  `- ${issue.identifier}: ${issue.title}\n  Priority: ${issue.priority || 'None'}\n  Status: ${issue.stateName}\n  ${issue.url}`
                ).join('\n')
                  }`,
                metadata: baseResponse
              }]
            };
          }

          case "linear_add_comment": {
            if (!args.issueId || !args.body) {
              throw new Error("Missing required fields: issueId and body");
            }

            const { comment, issue } = await linearClient.addComment({
              issueId: String(args.issueId),
              body: String(args.body),
              createAsUser: args.createAsUser ? String(args.createAsUser) : undefined,
              displayIconUrl: args.displayIconUrl ? String(args.displayIconUrl) : undefined
            });

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

        const errorResponse: MCPMetricsResponse = {
          apiMetrics: {
            requestsInLastHour: metrics.requestsInLastHour,
            remainingRequests: linearClient.rateLimiter.requestsPerHour - metrics.requestsInLastHour,
            averageRequestTime: `${Math.round(metrics.averageRequestTime)}ms`,
            queueLength: metrics.queueLength
          }
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error)
            }),
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
    console.error(`Fatal error in main(): ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error in main():", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
