import type { Octokit } from "@octokit/core";
import type {
  Changes,
  State,
  TreeParameter,
  UpdateFunctionFile,
} from "./types";

import { valueToTreeObject } from "./value-to-tree-object";

export async function createTreeAndCommit(
  state: Required<State>,
  changes: Changes
): Promise<void> {
  const {
    octokit,
    owner,
    repo,
    fork,
    latestCommitSha,
    latestCommitTreeSha,
  } = state;
  const tree = (
    await Promise.all(
      Object.keys(changes.files).map(async (path) => {
        const value = changes.files[path];

        if (value === null) {
          // Deleting a non-existent file from a tree leads to an "GitRPC::BadObjectState" error,
          // so we only attempt to delete the file if it exists.
          try {
            // https://developer.github.com/v3/repos/contents/#get-contents
            await octokit.request("HEAD /repos/:owner/:repo/contents/:path", {
              owner: fork,
              repo,
              ref: latestCommitSha,
              path,
            });

            return {
              path,
              mode: "100644",
              sha: null,
            };
          } catch (error) {
            return;
          }
        }

        // When passed a function, retrieve the content of the file, pass it
        // to the function, then return the result
        if (typeof value === "function") {
          const { data: file } = await octokit.request(
            "GET /repos/:owner/:repo/contents/:path",
            {
              owner: fork,
              repo,
              ref: latestCommitSha,
              path,
            }
          );

          const result = await value(file as UpdateFunctionFile);
          return valueToTreeObject(octokit, owner, repo, path, result);
        }

        return valueToTreeObject(octokit, owner, repo, path, value);
      })
    )
  ).filter(Boolean) as TreeParameter;

  // https://developer.github.com/v3/git/trees/#create-a-tree
  const {
    data: { sha: newTreeSha },
  } = await octokit.request("POST /repos/:owner/:repo/git/trees", {
    owner: fork,
    repo,
    base_tree: latestCommitTreeSha,
    tree,
  });

  // https://developer.github.com/v3/git/commits/#create-a-commit
  const { data: latestCommit } = await octokit.request(
    "POST /repos/:owner/:repo/git/commits",
    {
      owner: fork,
      repo,
      message: changes.commit,
      tree: newTreeSha,
      parents: [latestCommitSha],
    }
  );

  state.latestCommitSha = latestCommit.sha;
  state.latestCommitTreeSha = latestCommit.tree.sha;
}
