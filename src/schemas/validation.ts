import { z } from 'zod';
import {
  CreateIssueArgs,
  UpdateIssueArgs,
  SearchIssuesArgs,
  GetUserIssuesArgs,
  AddCommentArgs
} from '../interfaces/linear';

export const CreateIssueArgsSchema = z.object({
  title: z.string().describe("Issue title"),
  teamId: z.string().describe("Team ID"),
  description: z.string().optional().describe("Issue description"),
  priority: z.number().min(0).max(4).optional().describe("Priority (0-4)"),
  status: z.string().optional().describe("Issue status")
}) satisfies z.ZodType<CreateIssueArgs>;

export const UpdateIssueArgsSchema = z.object({
  id: z.string().describe("Issue ID"),
  title: z.string().optional().describe("New title"),
  description: z.string().optional().describe("New description"),
  priority: z.number().optional().describe("New priority (0-4)"),
  status: z.string().optional().describe("New status")
}) satisfies z.ZodType<UpdateIssueArgs>;

export const SearchIssuesArgsSchema = z.object({
  query: z.string().optional().describe("Optional text to search in title and description"),
  teamId: z.string().optional().describe("Filter by team ID"),
  status: z.string().optional().describe("Filter by status name (e.g., 'In Progress', 'Done')"),
  assigneeId: z.string().optional().describe("Filter by assignee's user ID"),
  labels: z.array(z.string()).optional().describe("Filter by label names"),
  priority: z.number().optional().describe("Filter by priority (1=urgent, 2=high, 3=normal, 4=low)"),
  estimate: z.number().optional().describe("Filter by estimate points"),
  includeArchived: z.boolean().optional().describe("Include archived issues in results (default: false)"),
  limit: z.number().optional().describe("Max results to return (default: 10)")
}) satisfies z.ZodType<SearchIssuesArgs>;

export const GetUserIssuesArgsSchema = z.object({
  userId: z.string().optional().describe("Optional user ID. If not provided, returns authenticated user's issues"),
  includeArchived: z.boolean().optional().describe("Include archived issues in results"),
  limit: z.number().optional().describe("Maximum number of issues to return (default: 50)")
}) satisfies z.ZodType<GetUserIssuesArgs>;

export const AddCommentArgsSchema = z.object({
  issueId: z.string().describe("ID of the issue to comment on"),
  body: z.string().describe("Comment text in markdown format"),
  createAsUser: z.string().optional().describe("Optional custom username to show for the comment"),
  displayIconUrl: z.string().optional().describe("Optional avatar URL for the comment")
}) satisfies z.ZodType<AddCommentArgs>; 