/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { endGroup, startGroup } from "@actions/core";
import type { GitHub } from "@actions/github/lib/utils";
import { Context } from "@actions/github/lib/context";
import {
  ChannelSuccessResult,
  interpretChannelDeployResult,
  ErrorResult,
} from "./deploy";
import { createDeploySignature } from "./hash";

export function createBotCommentIdentifier(signature: string) {
  return function isCommentByBot(comment): boolean {
    return comment.user.type === "Bot" && comment.body.includes(signature);
  };
}

export function getURLsMarkdownFromChannelDeployResult(
  result: ChannelSuccessResult
): string {
  const { urls } = interpretChannelDeployResult(result);

  return urls.length === 1
    ? `[${urls[0]}](${urls[0]})`
    : urls.map((url) => `- [${url}](${url})`).join("\n");
}

export function getChannelDeploySuccessComment(
  result: ChannelSuccessResult,
  commit: string,
  siteId: string,
  siteIds: string[],
  existingCommentBody?: string
): string {
  const deploySignature = createDeploySignature(result);
  const urlList = getURLsMarkdownFromChannelDeployResult(result);
  const { expireTime } = interpretChannelDeployResult(result);
  let urlBlock = "";

  if (existingCommentBody) {
    urlBlock = getUrlLines(existingCommentBody);

    console.log("Parsed existing URL block", urlBlock);

    const existingSiteIds = getSiteIds(urlBlock);

    console.log(
      "Found existing siteIds",
      existingSiteIds,
      typeof existingSiteIds
    );

    const sitesToRemove = existingSiteIds.filter(
      (existingSiteId) => !siteIds.includes(existingSiteId)
    );

    if (sitesToRemove.length) {
      console.log("Found sites to remove", sitesToRemove, typeof sitesToRemove);
      urlBlock = removeUnusedSiteIds(urlBlock, sitesToRemove);
      console.log("URL block after remove", urlBlock, typeof urlBlock);
    }
  }

  console.log(
    "URL block before replacement",
    urlBlock,
    typeof urlBlock,
    siteId,
    typeof siteId,
    urlList,
    typeof urlList
  );

  urlBlock = replaceLineWithText(urlBlock, siteId, urlList);
  console.log("URL block after replacement", urlBlock, typeof urlBlock);

  return `
Visit the preview URL(s) for this PR (updated for commit ${commit}):

${urlBlock}

<sub>(expires ${new Date(expireTime).toUTCString()})</sub>

<sub>Sign: ${deploySignature}</sub>`.trim();
}

export async function postChannelSuccessComment(
  github: InstanceType<typeof GitHub>,
  context: Context,
  result: ChannelSuccessResult,
  commit: string,
  siteId: string,
  siteIds: string[]
) {
  const commentInfo = {
    ...context.repo,
    issue_number: context.issue.number,
  };

  startGroup(`Commenting on PR`);
  const deploySignature = createDeploySignature(result);
  const isCommentByBot = createBotCommentIdentifier(deploySignature);

  let existingComment;
  try {
    const comments = (await github.issues.listComments(commentInfo)).data;
    for (let i = comments.length; i--; ) {
      const c = comments[i];
      if (isCommentByBot(c)) {
        existingComment = c;
        break;
      }
    }
  } catch (e) {
    console.log("Error checking for previous comments: " + e.message);
  }

  if (existingComment) {
    console.log("Found existing comment");
    try {
      const commentMarkdown = getChannelDeploySuccessComment(
        result,
        commit,
        siteId,
        siteIds,
        existingComment.body
      );

      const comment = {
        ...commentInfo,
        body: commentMarkdown,
      };

      await github.issues.updateComment({
        ...context.repo,
        comment_id: existingComment.id,
        body: comment.body,
      });
    } catch (e) {
      existingComment = null;
    }
  }

  if (!existingComment) {
    console.log("Creating new comment");
    try {
      const commentMarkdown = getChannelDeploySuccessComment(
        result,
        commit,
        siteId,
        siteIds
      );

      const comment = {
        ...commentInfo,
        body: commentMarkdown,
      };

      await github.issues.createComment(comment);
    } catch (e) {
      console.log(`Error creating comment: ${e.message}`);
    }
  }
  endGroup();
}

function getUrlLines(commentBody: string): string {
  const lines = commentBody.split("\n");

  return lines.filter((line) => line.startsWith(">")).join("\n");
}

function replaceLineWithText(
  commentBody: string,
  siteId: string,
  url: string
): string {
  // Split the text into an array of lines
  const lines = commentBody.split("\n");
  const siteLine = `> [${siteId}] ${url}`;
  let exists = false;

  // Loop through each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if the line contains the search text
    if (line.includes(siteId)) {
      exists = true;
      // Replace the line with the replacement text
      lines[i] = siteLine;
      break;
    }
  }

  if (!exists) {
    lines.push(siteLine);
  }

  // Join the lines back together into a single string and return it
  return lines.join("\n");
}

function removeUnusedSiteIds(
  urlBlock: string,
  sitesToRemove: string[]
): string {
  // Split the text into an array of lines
  const lines = urlBlock.split("\n");

  return lines
    .filter((line) =>
      sitesToRemove.some((siteId) => line.startsWith(`> [${siteId}]`))
    )
    .join("\n");
}

function getSiteIds(commentBody: string): string[] {
  const regex = /\[(.+)\]\s/g;
  const labels = [];
  let match;
  while ((match = regex.exec(commentBody)) !== null) {
    labels.push(match[1]);
  }
  return labels;
}
