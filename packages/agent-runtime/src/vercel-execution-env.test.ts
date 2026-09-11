import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FileError, Result } from "@earendil-works/pi-agent-core";
import {
  VercelVirtualExecutionEnv,
  createVercelVirtualExecutionEnv
} from "./vercel-execution-env";

test("virtual filesystem implements Pi FileSystem operations with Result values", async () => {
  const env = createVercelVirtualExecutionEnv({
    files: {
      "notes/a.txt": "alpha\nbeta\nneedle\n",
      "/workspace/root.txt": "root\n"
    }
  });

  assert.deepEqual(await env.createDir("out/nested"), { ok: true, value: undefined });
  assert.deepEqual(await env.writeFile("out/nested/b.txt", "one\ntwo\n"), { ok: true, value: undefined });
  assert.deepEqual(await env.appendFile("out/nested/b.txt", "three\n"), { ok: true, value: undefined });
  assert.equal(unwrap(await env.readTextFile("out/nested/b.txt")), "one\ntwo\nthree\n");
  assert.deepEqual(unwrap(await env.readTextLines("out/nested/b.txt", { maxLines: 2 })), ["one", "two"]);
  assert.deepEqual(Array.from(unwrap(await env.readBinaryFile("out/nested/b.txt")).slice(0, 3)), [111, 110, 101]);

  const info = unwrap(await env.fileInfo("out/nested/b.txt"));
  assert.equal(info.name, "b.txt");
  assert.equal(info.kind, "file");
  assert.equal(info.path, "/workspace/out/nested/b.txt");

  assert.deepEqual(
    unwrap(await env.listDir("out/nested")).map((entry) => ({ name: entry.name, kind: entry.kind })),
    [{ name: "b.txt", kind: "file" }]
  );
  assert.equal(unwrap(await env.exists("out/nested/b.txt")), true);
  assert.equal(unwrap(await env.exists("missing.txt")), false);
  assert.equal(unwrap(await env.canonicalPath("./out/nested/b.txt")), "/workspace/out/nested/b.txt");
  assert.equal(unwrap(await env.absolutePath("../workspace/root.txt")), "/workspace/root.txt");
  assert.equal(unwrap(await env.joinPath(["/workspace", "out", "nested"])), "/workspace/out/nested");

  const tempDir = unwrap(await env.createTempDir("learnordie-"));
  assert.match(tempDir, /^\/tmp\/learnordie-/);
  const tempFile = unwrap(await env.createTempFile({ prefix: "pi-", suffix: ".txt" }));
  assert.match(tempFile, /^\/tmp\/tmp-[^/]+\/pi-[^/]+\.txt$/);

  assert.deepEqual(await env.remove("out", { recursive: true }), { ok: true, value: undefined });
  assert.equal(unwrap(await env.exists("out")), false);
  assert.deepEqual(await env.remove("already-gone", { force: true }), { ok: true, value: undefined });
});

test("filesystem failures resolve as FileError results instead of throwing", async () => {
  const env = createVercelVirtualExecutionEnv();

  const missingRead = await env.readTextFile("missing.txt");
  assertFileError(missingRead, "not_found");

  const missingInfo = await env.fileInfo("missing.txt");
  assertFileError(missingInfo, "not_found");

  const missingList = await env.listDir("missing");
  assertFileError(missingList, "not_found");

  await env.writeFile("file.txt", "content");
  const listFile = await env.listDir("file.txt");
  assertFileError(listFile, "not_directory");

  const removeDirectoryWithoutRecursive = await env.remove("/", { recursive: true });
  assertFileError(removeDirectoryWithoutRecursive, "permission_denied");
});

test("abort signals use Pi FileError and ExecutionError result shapes", async () => {
  const env = createVercelVirtualExecutionEnv({ files: { "a.txt": "alpha\n" } });
  const controller = new AbortController();
  controller.abort();

  assertFileError(await env.readTextFile("a.txt", controller.signal), "aborted");
  assertFileError(await env.writeFile("b.txt", "beta", controller.signal), "aborted");
  assertFileError(await env.createDir("dir", { abortSignal: controller.signal }), "aborted");

  const execResult = await env.exec("pwd", { abortSignal: controller.signal });
  assert.equal(execResult.ok, false);
  if (!execResult.ok) assert.equal(execResult.error.code, "aborted");
});

test("virtual shell allowlist runs only inside virtualfs", async () => {
  const env = createVercelVirtualExecutionEnv({
    files: {
      "a.txt": "alpha\nbeta\n",
      "b.txt": "alpha\ngamma\n"
    },
    shellEnv: { USER: "learnordie" }
  });

  assert.deepEqual(unwrap(await env.exec("pwd")), {
    stdout: "/workspace\n",
    stderr: "",
    exitCode: 0
  });
  assert.equal(unwrap(await env.exec("ls")).stdout, "a.txt\nb.txt\n");
  assert.equal(unwrap(await env.exec("head -n 1 a.txt")).stdout, "alpha\n");
  assert.equal(unwrap(await env.exec("tail -n 1 a.txt")).stdout, "beta\n");
  assert.equal(unwrap(await env.exec("wc -l a.txt")).stdout, "2 a.txt\n");
  assert.equal(unwrap(await env.exec("grep -n alpha a.txt b.txt")).stdout, "a.txt:1:alpha\nb.txt:1:alpha\n");
  assert.equal(unwrap(await env.exec("printenv USER")).stdout, "learnordie\n");

  assert.equal(unwrap(await env.exec("cp a.txt copy.txt")).exitCode, 0);
  assert.equal(unwrap(await env.exec("mv copy.txt moved.txt")).exitCode, 0);
  assert.equal(unwrap(await env.readTextFile("moved.txt")), "alpha\nbeta\n");

  assert.equal(unwrap(await env.exec("mkdir -p nested/dir")).exitCode, 0);
  assert.equal(unwrap(await env.exec("touch nested/dir/empty.txt")).exitCode, 0);
  assert.equal(unwrap(await env.exists("nested/dir/empty.txt")), true);
  assert.equal(unwrap(await env.exec("rm -r nested")).exitCode, 0);
  assert.equal(unwrap(await env.exists("nested")), false);

  const diff = unwrap(await env.exec("diff a.txt b.txt"));
  assert.equal(diff.exitCode, 1);
  assert.match(diff.stdout, /--- a\.txt\n\+\+\+ b\.txt\n@@/);
});

test("virtual shell supports pipes and output redirects without host shell access", async () => {
  const env = createVercelVirtualExecutionEnv({
    files: {
      "source.txt": "first\nsecond needle\nthird\n"
    }
  });

  assert.deepEqual(unwrap(await env.exec("cat source.txt | grep needle")), {
    stdout: "second needle\n",
    stderr: "",
    exitCode: 0
  });

  assert.deepEqual(unwrap(await env.exec("echo captured > out/captured.txt")), {
    stdout: "",
    stderr: "",
    exitCode: 0
  });
  assert.equal(unwrap(await env.readTextFile("out/captured.txt")), "captured\n");

  assert.equal(unwrap(await env.exec("echo appended >> out/captured.txt")).exitCode, 0);
  assert.equal(unwrap(await env.readTextFile("out/captured.txt")), "captured\nappended\n");

  const stderrRedirect = unwrap(await env.exec("cat missing.txt 2> out/stderr.txt"));
  assert.equal(stderrRedirect.exitCode, 1);
  assert.equal(stderrRedirect.stderr, "");
  assert.match(unwrap(await env.readTextFile("out/stderr.txt")), /cat: \/workspace\/missing\.txt:/);
});

test("virtual shell rejects host commands and unsupported syntax", async () => {
  const env = createVercelVirtualExecutionEnv();

  for (const command of ["node -e console.log(1)", "npm install", "curl https://example.com", "bash -lc pwd", "chmod 777 file"]) {
    const result = unwrap(await env.exec(command));
    assert.equal(result.exitCode, 127);
    assert.match(result.stderr, /command not available in Vercel virtual shell/);
  }

  for (const command of ["echo a && echo b", "echo a || echo b", "echo a; echo b"]) {
    const result = unwrap(await env.exec(command));
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "shell: command chaining is not supported\n");
  }

  const inputRedirect = unwrap(await env.exec("cat < file.txt"));
  assert.equal(inputRedirect.exitCode, 2);
  assert.equal(inputRedirect.stderr, "shell: input redirection is not supported\n");
});

test("shell callbacks and snapshots follow Pi adapter boundaries", async () => {
  const env = new VercelVirtualExecutionEnv({ files: { "a.txt": "alpha\n" } });

  let stdout = "";
  const output = unwrap(await env.exec("cat a.txt", { onStdout: (chunk) => { stdout += chunk; } }));
  assert.equal(output.stdout, "alpha\n");
  assert.equal(stdout, "alpha\n");

  const callbackError = await env.exec("cat a.txt", {
    onStdout: () => {
      throw new Error("callback failed");
    }
  });
  assert.equal(callbackError.ok, false);
  if (!callbackError.ok) assert.equal(callbackError.error.code, "callback_error");

  const snapshot = unwrap(env.snapshotTextFiles("/workspace"));
  assert.deepEqual(snapshot, [
    { path: "/workspace", kind: "directory" },
    { path: "/workspace/a.txt", kind: "file", content: "alpha\n" }
  ]);
});

test("virtual execution env source does not import host filesystem or process execution APIs", () => {
  const source = readFileSync(new URL("./vercel-execution-env.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /from ["']node:fs/);
  assert.doesNotMatch(source, /from ["']node:fs\/promises/);
  assert.doesNotMatch(source, /from ["']node:child_process/);
  assert.doesNotMatch(source, /\bchild_process\b/);
  assert.doesNotMatch(source, /\bprocess\.env\b/);
});

function unwrap<T, TError>(result: Result<T, TError>): T {
  if (!result.ok) {
    const message = result.error instanceof Error ? result.error.message : JSON.stringify(result.error);
    assert.fail(`Expected ok Result, got error: ${message}`);
  }
  return result.value;
}

function assertFileError<T>(result: Result<T, FileError>, code: FileError["code"]): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, code);
}
