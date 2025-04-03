export interface CreateIssueArgs {
  title: string;
  teamId: string;
  description?: string;
  priority?: number;
  status?: string;
}

export interface UpdateIssueArgs {
  id: string;
  title?: string;
  description?: string;
  priority?: number;
  status?: string;
}

export interface SearchIssuesArgs {
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

export interface GetUserIssuesArgs {
  userId?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface AddCommentArgs {
  issueId: string;
  body: string;
  createAsUser?: string;
  displayIconUrl?: string;
}

export interface RateLimiterMetrics {
  totalRequests: number;
  requestsInLastHour: number;
  averageRequestTime: number;
  queueLength: number;
  lastRequestTime: number;
}

export interface LinearIssueResponse {
  identifier: string;
  title: string;
  priority: number | null;
  status: string | null;
  stateName?: string;
  url: string;
}

export interface MCPMetricsResponse {
  apiMetrics: {
    requestsInLastHour: number;
    remainingRequests: number;
    averageRequestTime: string;
    queueLength: number;
  }
} 