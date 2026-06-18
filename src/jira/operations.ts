import { jiraClient } from './client.js';
import { JiraTicket, EnhancedJiraTicket } from './types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    id: string;
    fields: {
      summary: string;
      status: {
        name: string;
      };
      issuetype: {
        name: string;
      };
      created: string;
    };
  }>;
  maxResults: number;
  total: number;
}

function extractTextFromADF(adf: any): string {
  // Recursively extract text from Atlassian Document Format
  if (!adf) return '';

  if (typeof adf === 'string') return adf;

  if (adf.type === 'text') {
    return adf.text || '';
  }

  if (adf.content && Array.isArray(adf.content)) {
    return adf.content.map((node: any) => extractTextFromADF(node)).join('');
  }

  // Add newlines for paragraphs, headings, etc.
  if (adf.type === 'paragraph' || adf.type === 'heading') {
    const text = adf.content ? adf.content.map((node: any) => extractTextFromADF(node)).join('') : '';
    return text + '\n\n';
  }

  return '';
}

export async function fetchRecentTickets(): Promise<JiraTicket[]> {
  try {
    const boardIds = config.jira.boardIds;
    logger.info(`Fetching tickets from ${boardIds.length} board(s): ${boardIds.join(', ')}`);

    // Create Basic Auth header
    const authString = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');

    // Fetch tickets from each board using the Agile API
    const allTickets: JiraTicket[] = [];
    const threeHoursAgo = new Date(Date.now() - 36 * 60 * 60 * 1000);

    for (const boardId of boardIds) {
      try {
        // Use the Agile API board endpoint with JQL filter
        const boardUrl = new URL(`${config.jira.baseUrl}/rest/agile/1.0/board/${boardId}/issue`);
        boardUrl.searchParams.append('jql', `created >= -36h ORDER BY created DESC`);
        boardUrl.searchParams.append('fields', 'summary,status,created');
        boardUrl.searchParams.append('maxResults', '100');

        const response = await fetch(boardUrl.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authString}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch from board ${boardId}: ${response.status} ${response.statusText}`);
          continue;
        }

        const searchResults = await response.json() as JiraSearchResponse;

        const boardTickets: JiraTicket[] = searchResults.issues
          .filter((issue: any) => {
            const created = new Date(issue.fields.created);
            return created >= threeHoursAgo;
          })
          .map((issue: any) => ({
            key: issue.key,
            id: issue.id,
            summary: issue.fields.summary,
            status: issue.fields.status.name,
            issueType: issue.fields.issuetype?.name || 'custom',
            created: issue.fields.created,
            url: `${config.jira.baseUrl}/browse/${issue.key}`,
          }));

        logger.info(`Found ${boardTickets.length} recent tickets from board ${boardId}`);
        allTickets.push(...boardTickets);
      } catch (error) {
        logger.error(`Error fetching from board ${boardId}:`, error);
        // Continue with other boards even if one fails
      }
    }

    // Remove duplicates (tickets can appear on multiple boards)
    const uniqueTickets = Array.from(
      new Map(allTickets.map(ticket => [ticket.key, ticket])).values()
    );

    logger.info(`Found ${uniqueTickets.length} unique tickets across all boards (${allTickets.length} total)`);
    return uniqueTickets;
  } catch (error) {
    logger.error('Failed to fetch tickets from Jira:', error);
    throw error;
  }
}

export async function fetchToDoTickets(): Promise<JiraTicket[]> {
  try {
    const boardIds = config.jira.boardIds;
    logger.info(`Fetching "New" tickets from ${boardIds.length} board(s): ${boardIds.join(', ')}`);

    // Create Basic Auth header
    const authString = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');

    // Fetch tickets from each board using the Agile API
    const allTickets: JiraTicket[] = [];

    for (const boardId of boardIds) {
      try {
        // Use the Agile API board endpoint with JQL filter for "New" status
        const boardUrl = new URL(`${config.jira.baseUrl}/rest/agile/1.0/board/${boardId}/issue`);
        boardUrl.searchParams.append('jql', `status = "New" ORDER BY created DESC`);
        boardUrl.searchParams.append('fields', 'summary,status,issuetype,created,components');
        boardUrl.searchParams.append('maxResults', '100');

        const response = await fetch(boardUrl.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authString}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch from board ${boardId}: ${response.status} ${response.statusText}`);
          continue;
        }

        const searchResults = await response.json() as JiraSearchResponse;

        const boardTickets: JiraTicket[] = searchResults.issues.map((issue: any) => ({
          key: issue.key,
          id: issue.id,
          summary: issue.fields.summary,
          status: issue.fields.status.name,
          issueType: issue.fields.issuetype?.name || 'custom',
          created: issue.fields.created,
          url: `${config.jira.baseUrl}/browse/${issue.key}`,
        }));

        logger.info(`Found ${boardTickets.length} "New" tickets from board ${boardId}`);
        allTickets.push(...boardTickets);
      } catch (error) {
        logger.error(`Error fetching from board ${boardId}:`, error);
        // Continue with other boards even if one fails
      }
    }

    // Remove duplicates (tickets can appear on multiple boards)
    const uniqueTickets = Array.from(
      new Map(allTickets.map(ticket => [ticket.key, ticket])).values()
    );

    logger.info(`Found ${uniqueTickets.length} unique "New" tickets across all boards (${allTickets.length} total)`);
    return uniqueTickets;
  } catch (error) {
    logger.error('Failed to fetch "New" tickets from Jira:', error);
    throw error;
  }
}

export async function fetchTicketDetails(issueKey: string): Promise<EnhancedJiraTicket> {
  try {
    logger.info(`Fetching full details for ticket ${issueKey}`);

    const authString = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');

    // Fetch with all fields
    const issueUrl = `${config.jira.baseUrl}/rest/api/3/issue/${issueKey}`;
    const response = await fetch(issueUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ticket ${issueKey}: ${response.status} ${response.statusText}`);
    }

    const issue: any = await response.json();

    // Extract components
    const components = issue.fields.components?.map((c: any) => c.name) || [];

    // Extract labels
    const labels = issue.fields.labels || [];

    // Extract epic key (if present)
    const epicKey = issue.fields.parent?.key || issue.fields.epic?.key;

    // Parse description (Atlassian Document Format to plain text)
    const descriptionRaw = issue.fields.description || '';
    let description = '';

    if (typeof descriptionRaw === 'string') {
      description = descriptionRaw;
    } else if (descriptionRaw && typeof descriptionRaw === 'object' && descriptionRaw.type === 'doc') {
      // Atlassian Document Format - extract text
      description = extractTextFromADF(descriptionRaw);
    } else {
      description = JSON.stringify(descriptionRaw);
    }

    // Try to find acceptance criteria in description
    let acceptanceCriteria: string | undefined;
    const acMatch = description.match(/acceptance criteria[:\s]+(.+?)(?=\n\n|$)/is);
    if (acMatch) {
      acceptanceCriteria = acMatch[1].trim();
    }

    const enhancedTicket: EnhancedJiraTicket = {
      key: issue.key,
      id: issue.id,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      issueType: issue.fields.issuetype?.name || 'Unknown',
      created: issue.fields.created,
      url: `${config.jira.baseUrl}/browse/${issue.key}`,
      description,
      components,
      labels,
      epicKey,
      acceptanceCriteria,
      customFields: issue.fields,
    };

    logger.info(`Fetched details for ${issueKey}: ${components.length} components, ${labels.length} labels`);
    return enhancedTicket;
  } catch (error) {
    logger.error(`Failed to fetch ticket details for ${issueKey}:`, error);
    throw error;
  }
}

export async function addCommentToTicket(issueKey: string, comment: string): Promise<void> {
  try {
    logger.info(`Adding comment to ticket ${issueKey}`);

    const authString = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');

    const commentUrl = `${config.jira.baseUrl}/rest/api/3/issue/${issueKey}/comment`;
    const response = await fetch(commentUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: comment,
                },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to add comment: ${response.status} ${response.statusText}`);
    }

    logger.info(`Successfully added comment to ${issueKey}`);
  } catch (error) {
    logger.error(`Failed to add comment to ${issueKey}:`, error);
    throw error;
  }
}

export async function findRelatedTickets(
  components: string[],
  project: string,
  limit: number = 10
): Promise<JiraTicket[]> {
  try {
    logger.info(`Finding related tickets for components: ${components.join(', ')}`);

    if (components.length === 0) {
      return [];
    }

    const authString = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');

    // Build JQL to find tickets with same components
    const componentFilter = components.map((c) => `component = "${c}"`).join(' OR ');
    const jql = `project = ${project} AND (${componentFilter}) AND status IN (Done, Closed) ORDER BY updated DESC`;

    const searchUrl = new URL(`${config.jira.baseUrl}/rest/api/3/search`);
    searchUrl.searchParams.append('jql', jql);
    searchUrl.searchParams.append('fields', 'summary,status,created');
    searchUrl.searchParams.append('maxResults', limit.toString());

    const response = await fetch(searchUrl.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn(`Failed to find related tickets: ${response.status} ${response.statusText}`);
      return [];
    }

    const searchResults = await response.json() as JiraSearchResponse;

    const tickets = searchResults.issues.map((issue: any) => ({
      key: issue.key,
      id: issue.id,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      issueType: issue.fields.issuetype?.name || 'custom',
      created: issue.fields.created,
      url: `${config.jira.baseUrl}/browse/${issue.key}`,
    }));

    logger.info(`Found ${tickets.length} related tickets`);
    return tickets;
  } catch (error) {
    logger.error('Failed to find related tickets:', error);
    return [];
  }
}

export async function assignTicket(issueKey: string): Promise<void> {
  try {
    const accountId = jiraClient.getUserAccountId();

    logger.info(`Assigning ticket ${issueKey} to user ${accountId}`);

    await jiraClient.getClient().updateAssignee(issueKey, accountId);

    logger.info(`Successfully assigned ticket ${issueKey}`);
  } catch (error: any) {
    if (error.statusCode === 400 || error.message?.includes('already assigned')) {
      logger.warn(`Ticket ${issueKey} is already assigned or cannot be assigned`);
      throw new Error('Ticket is already assigned or cannot be assigned to you');
    }
    logger.error(`Failed to assign ticket ${issueKey}:`, error);
    throw new Error(`Failed to assign ticket: ${error.message || 'Unknown error'}`);
  }
}
