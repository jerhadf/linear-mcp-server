//evals.ts

import { EvalConfig } from 'mcp-evals';
import { openai } from "@ai-sdk/openai";
import { grade, EvalFunction } from "mcp-evals";

const linear_create_issueEval: EvalFunction = {
    name: "Linear Create Issue Tool Evaluation",
    description: "Evaluates the correctness and completeness of the linear_create_issue tool usage",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please create a new Linear issue using the linear_create_issue tool. The issue should have the title 'Fix login bug for Safari users', teamId 'team123', description 'Safari users are unable to log in properly', priority 2, and status 'Open'. Return the issue identifier and URL.");
        return JSON.parse(result);
    }
};

const linear_update_issueEval: EvalFunction = {
    name: "linear_update_issue Evaluation",
    description: "Evaluates the tool's ability to update existing issue details in a Linear project",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please update the existing Linear issue with ID 'ISS-786' to have the title 'New Title', description 'Revised description for clarity', priority 3, and status 'In Review'.");
        return JSON.parse(result);
    }
};

const linear_search_issuesEval: EvalFunction = {
    name: "linear_search_issues",
    description: "Evaluates the linear_search_issues tool for searching issues based on flexible criteria",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Find any open issues assigned to user 'usr_123' that mention 'bug' in their title or description, have a priority of 2, and return no more than 5 results while ignoring archived issues.");
        return JSON.parse(result);
    }
};

const linear_get_user_issuesEval: EvalFunction = {
    name: "linear_get_user_issues Evaluation",
    description: "Evaluates the correctness of retrieving user issues including optional parameters",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Retrieve the assigned issues for user 123, including archived issues, limited to 10.");
        return JSON.parse(result);
    }
};

const linear_add_commentEval: EvalFunction = {
    name: "linear_add_comment Evaluation",
    description: "Evaluates the correctness of the linear_add_comment functionality",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please add a comment to the Linear issue with ID ABC123. The comment should be in markdown format saying: 'Testing comment functionality!'. Use a custom user name 'TestUser' and avatar 'http://test.avatar.com'. Return the created comment's details including its URL.");
        return JSON.parse(result);
    }
};

const config: EvalConfig = {
    model: openai("gpt-4"),
    evals: [linear_create_issueEval, linear_update_issueEval, linear_search_issuesEval, linear_get_user_issuesEval, linear_add_commentEval]
};
  
export default config;
  
export const evals = [linear_create_issueEval, linear_update_issueEval, linear_search_issuesEval, linear_get_user_issuesEval, linear_add_commentEval];