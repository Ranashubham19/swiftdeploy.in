export type CodeExecutionResult = {
  ok: boolean;
  language: string;
  command: string;
  args: string[];
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};
