// Per-session work lanes (FR-053, research R17): one summary lane and one question lane per session,
// each running one job at a time, in `seq` order. A queued job can be cancelled before it starts; a
// refresh cancels every queued job of older snapshots as `superseded` (FR-051); closing a session
// cancels its queued and running jobs. Lanes are in memory only: what a job did is in the store.

import type { CancelReason } from '../store/review-store.ts';

export type LaneName = 'summary' | 'question';

export type LaneJob = {
  id: string;
  /** Order within the lane: the question's `seq`, or the run's request order. */
  seq: number;
  snapshotId: string;
  /** Does the work and writes its terminal record. */
  run(): Promise<void>;
  /**
   * Called when the job is cancelled. Before it started it must write its own cancelled record;
   * while running it must stop the work, and `run` writes the record.
   */
  cancel(reason: CancelReason, started: boolean): void;
};

export type JobState = 'queued' | 'running';

export interface Lanes {
  enqueue(sessionId: string, lane: LaneName, job: LaneJob): void;
  /** The job's place in its lane, or null once it has left it. */
  state(jobId: string): JobState | null;
  /** Cancels a queued or running job; false when the lane no longer holds it. */
  cancel(jobId: string, reason: CancelReason): boolean;
  /** Resolves when the job has left its lane (at once when it is not in one). */
  settled(jobId: string): Promise<void>;
  /** Resolves when the jobs running for the session now have ended. */
  settledRunning(sessionId: string): Promise<void>;
  /** Cancels every queued job of the session whose snapshot is not `keepSnapshotId`; returns their ids. */
  cancelQueued(sessionId: string, reason: CancelReason, keepSnapshotId?: string): string[];
  /** The session was closed (or the workbench is stopping): cancels its queued and running jobs. */
  close(sessionId: string, reason?: CancelReason): void;
}

type Lane = { queue: LaneJob[]; running: LaneJob | null };
type Placed = { sessionId: string; lane: Lane; job: LaneJob; done: Promise<void>; finish: () => void };

export function createLanes(): Lanes {
  const sessions = new Map<string, Record<LaneName, Lane>>();
  const jobs = new Map<string, Placed>();

  const lanesOf = (sessionId: string): Record<LaneName, Lane> => {
    let found = sessions.get(sessionId);
    if (found === undefined) {
      found = { summary: { queue: [], running: null }, question: { queue: [], running: null } };
      sessions.set(sessionId, found);
    }
    return found;
  };

  const leave = (placed: Placed): void => {
    jobs.delete(placed.job.id);
    placed.finish();
  };

  const pump = (lane: Lane): void => {
    if (lane.running !== null) return;
    const next = lane.queue.shift();
    if (next === undefined) return;
    lane.running = next;
    const placed = jobs.get(next.id);
    void next
      .run()
      .catch(() => undefined) // a job records its own failure; the lane must keep moving
      .finally(() => {
        lane.running = null;
        if (placed !== undefined) leave(placed);
        pump(lane);
      });
  };

  const cancelQueuedJob = (placed: Placed, reason: CancelReason): void => {
    const at = placed.lane.queue.indexOf(placed.job);
    if (at !== -1) placed.lane.queue.splice(at, 1);
    leave(placed);
    placed.job.cancel(reason, false);
  };

  return {
    enqueue(sessionId, laneName, job) {
      const lane = lanesOf(sessionId)[laneName];
      let finish = (): void => undefined;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      jobs.set(job.id, { sessionId, lane, job, done, finish });
      const at = lane.queue.findIndex((queued) => queued.seq > job.seq);
      if (at === -1) lane.queue.push(job);
      else lane.queue.splice(at, 0, job);
      pump(lane);
    },

    state(jobId) {
      const placed = jobs.get(jobId);
      if (placed === undefined) return null;
      return placed.lane.running === placed.job ? 'running' : 'queued';
    },

    cancel(jobId, reason) {
      const placed = jobs.get(jobId);
      if (placed === undefined) return false;
      if (placed.lane.running === placed.job) placed.job.cancel(reason, true);
      else cancelQueuedJob(placed, reason);
      return true;
    },

    settled: (jobId) => jobs.get(jobId)?.done ?? Promise.resolve(),

    async settledRunning(sessionId) {
      const lanes = sessions.get(sessionId);
      if (lanes === undefined) return;
      await Promise.all([lanes.summary.running, lanes.question.running].map((job) => (job === null ? undefined : jobs.get(job.id)?.done)));
    },

    cancelQueued(sessionId, reason, keepSnapshotId) {
      const lanes = sessions.get(sessionId);
      if (lanes === undefined) return [];
      const cancelled: string[] = [];
      for (const lane of [lanes.summary, lanes.question]) {
        for (const job of [...lane.queue]) {
          if (job.snapshotId === keepSnapshotId) continue;
          const placed = jobs.get(job.id);
          if (placed !== undefined) cancelQueuedJob(placed, reason);
          cancelled.push(job.id);
        }
      }
      return cancelled;
    },

    close(sessionId, reason = 'user') {
      const lanes = sessions.get(sessionId);
      if (lanes === undefined) return;
      for (const lane of [lanes.summary, lanes.question]) {
        for (const job of [...lane.queue]) {
          const placed = jobs.get(job.id);
          if (placed !== undefined) cancelQueuedJob(placed, reason);
        }
        lane.running?.cancel(reason, true);
      }
    },
  };
}
