import { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";

export const resourceTemplates: ResourceTemplate[] = [
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