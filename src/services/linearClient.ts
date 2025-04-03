import { LinearClient, LinearDocument, Issue, User, Team, WorkflowState, IssueLabel } from "@linear/sdk";
import { RateLimiter } from '../utils/rateLimiter';
import {
  CreateIssueArgs,
  UpdateIssueArgs,
  SearchIssuesArgs,
  GetUserIssuesArgs,
  AddCommentArgs,
  LinearIssueResponse,
  MCPMetricsResponse
} from '../interfaces/linear';

export class LinearMCPClient {
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
    const issuePayload = await this.client.issueCreate({
      title: args.title,
      teamId: args.teamId,
      description: args.description,
      priority: args.priority,
      stateId: args.status
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
    const commentPayload = await this.client.commentCreate({
      issueId: args.issueId,
      body: args.body
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