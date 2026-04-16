import { useEffect, useRef, useState } from 'react';
import { cancelJob, getJobStatus, pauseJob, resumeJob, startLocalBatch, startUploadBatch } from '../api';
import { useAppStore } from '../store/useAppStore';
import type { ConversionLogEntry, JobEvent, JobStatusResponse } from '../types';
import { formatBytes } from '../utils/formatBytes';

function eventToLog(event: JobEvent): ConversionLogEntry | null {
  const time = Date.now();

  if (event.type === 'job_started') {
    return {
      time,
      kind: 'start',
      message: `Started batch ${event.job_id ?? ''} with ${event.workers ?? 0} workers.`,
    };
  }

  if (event.type === 'file_started') {
    return {
      time,
      kind: 'info',
      message: `Processing ${event.file ?? 'file'}...`,
    };
  }

  if (event.type === 'job_error') {
    return {
      time,
      kind: 'error',
      message: event.message ?? 'Unexpected batch error.',
    };
  }

  if (event.type === 'job_paused') {
    return {
      time,
      kind: 'info',
      message: 'Batch paused. Active files will finish before the queue stops.',
    };
  }

  if (event.type === 'job_resumed') {
    return {
      time,
      kind: 'info',
      message: 'Batch resumed.',
    };
  }

  if (event.type === 'job_cancel_requested') {
    return {
      time,
      kind: 'info',
      message: 'Cancellation requested. No new files will start.',
    };
  }

  if (event.type === 'job_cancelled') {
    return {
      time,
      kind: 'info',
      message: 'Batch cancelled after active files drained.',
    };
  }

  if (event.type === 'file_finished' && event.result) {
    if (event.result.error) {
      return {
        time,
        kind: 'error',
        message: `${event.current_file ?? event.result.input_path}: ${event.result.error}`,
      };
    }

    if (event.result.skipped) {
      return {
        time,
        kind: 'skipped',
        message: `${event.current_file ?? event.result.input_path}: skipped (${event.result.skip_reason ?? 'no action needed'}).`,
      };
    }

    const status = event.result.output_path.toLowerCase().endsWith('.jxl') ? 'success' : 'fallback';
    return {
      time,
      kind: status,
      message: `${event.current_file ?? event.result.input_path}: ${formatBytes(event.result.input_size)} → ${formatBytes(event.result.output_size)} (${event.result.savings_pct.toFixed(1)}%, ${Math.round(event.result.duration_ms)}ms).`,
    };
  }

  return null;
}

export function useConversionEngine() {
  const {
    appMode,
    settings,
    localSelectedPaths,
    outputDir,
    uploadFiles,
    jobStatus,
    setJobId,
    setJobStatus,
    setConversionResults,
    resetJobState,
  } = useAppStore();
  const [isConverting, setIsConverting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressPhase, setProgressPhase] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [stats, setStats] = useState({ completed: 0, total: 0, fallbacks: 0, errors: 0 });
  const [logs, setLogs] = useState<ConversionLogEntry[]>([]);
  const [hasRunBatch, setHasRunBatch] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenEventsRef = useRef(0);
  const activeJobRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const applyStatus = (status: JobStatusResponse) => {
    setJobStatus(status);
    setConversionResults(status.results);
    setIsPaused(status.paused);
    setStats({
      completed: status.completed,
      total: status.total,
      fallbacks: status.fallback_count,
      errors: status.error_count,
    });

    const nextProgress = status.total > 0 ? (status.completed / status.total) * 100 : status.done ? 100 : 0;
    setProgress(status.done ? 100 : nextProgress);
    setProgressPhase(
      status.cancelled
        ? 'Batch cancelled'
        : status.paused
          ? `Paused ${status.completed}/${status.total}`
          : status.done
            ? 'Batch complete'
            : `Converting ${status.completed}/${status.total}`,
    );
    setProgressDetail(
      status.cancel_requested && !status.done
        ? `Cancellation requested. Waiting for ${status.active} active file${status.active === 1 ? '' : 's'} to finish.`
        : status.paused
          ? `Paused with ${status.completed} of ${status.total} files completed.`
          : status.done
            ? `Finished ${status.success_count} conversions, ${status.fallback_count} fallbacks, ${status.skipped_count} skipped, ${status.error_count} errors.`
        : status.events.at(-1)?.current_file
          ? `Working on ${status.events.at(-1)?.current_file}`
          : 'Preparing batch...',
    );

    const newEvents = status.events.slice(seenEventsRef.current);
    seenEventsRef.current = status.events.length;

    if (newEvents.length > 0) {
      const newLogs = newEvents
        .map(eventToLog)
        .filter((entry): entry is ConversionLogEntry => entry !== null);
      if (newLogs.length > 0) {
        setLogs((existing) => [...newLogs.reverse(), ...existing].slice(0, 80));
      }
    }

    if (status.done) {
      stopPolling();
      setHasRunBatch(true);
      setIsPaused(false);
    }
  };

  const pollJob = async (jobId: string) => {
    try {
      const status = await getJobStatus(jobId);
      applyStatus(status);
    } catch (error) {
      stopPolling();
      setLogs((existing) => [{
        time: Date.now(),
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to fetch job status.',
      }, ...existing]);
    }
  };

  const startConversion = async () => {
    try {
      if (appMode === 'local') {
        if (localSelectedPaths.length === 0) {
          window.alert('Pick at least one local file or folder first.');
          return;
        }
        if (!outputDir) {
          window.alert('Choose an output folder before starting the export.');
          return;
        }
      } else if (uploadFiles.length === 0) {
        window.alert('Add at least one file to the upload queue first.');
        return;
      }

      resetJobState();
      setIsConverting(true);
      setIsPaused(false);
      setShowCancelConfirm(false);
      setHasRunBatch(false);
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setProgress(0);
      setProgressPhase('Preparing batch');
      setProgressDetail(appMode === 'local' ? 'Resolving local selection...' : 'Uploading files...');
      setLogs([]);
      setStats({ completed: 0, total: 0, fallbacks: 0, errors: 0 });
      seenEventsRef.current = 0;

      const response = appMode === 'local'
        ? await startLocalBatch(localSelectedPaths, outputDir, settings)
        : await startUploadBatch(uploadFiles, settings);

      activeJobRef.current = response.job_id;
      setJobId(response.job_id);
      setProgressDetail(`Batch ${response.job_id} started with ${response.total} file${response.total === 1 ? '' : 's'}.`);

      await pollJob(response.job_id);
      if (!pollingRef.current) {
        pollingRef.current = setInterval(() => {
          if (activeJobRef.current) {
            void pollJob(activeJobRef.current);
          }
        }, 500);
      }
    } catch (error) {
      setIsConverting(false);
      setLogs([{
        time: Date.now(),
        kind: 'error',
        message: error instanceof Error ? error.message : 'Unable to start conversion.',
      }]);
      window.alert(error instanceof Error ? error.message : 'Unable to start conversion.');
    }
  };

  const togglePause = () => {
    if (!activeJobRef.current) return;

    const action = isPaused ? resumeJob : pauseJob;
    void action(activeJobRef.current)
      .then(applyStatus)
      .catch((error) => {
        setLogs((existing) => [{
          time: Date.now(),
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unable to update pause state.',
        }, ...existing]);
      });
  };

  const cancelConversion = () => {
    if (!activeJobRef.current) {
      setIsConverting(false);
      setShowCancelConfirm(false);
      return;
    }

    void cancelJob(activeJobRef.current)
      .then((status) => {
        applyStatus(status);
        setShowCancelConfirm(false);
        if (status.done) {
          setIsConverting(false);
        }
      })
      .catch((error) => {
        setLogs((existing) => [{
          time: Date.now(),
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unable to cancel the batch.',
        }, ...existing]);
      });
  };

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    if (!isConverting || startedAtRef.current === null) {
      return;
    }

    const interval = setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isConverting]);

  const canPause = isConverting
    && Boolean(activeJobRef.current)
    && !jobStatus?.cancel_requested
    && !jobStatus?.done;

  return {
    isConverting,
    setIsConverting,
    isPaused,
    setIsPaused,
    showCancelConfirm,
    setShowCancelConfirm,
    progress,
    progressPhase,
    progressDetail,
    elapsedMs,
    activeCount: jobStatus?.active ?? 0,
    queuedCount: jobStatus?.queued ?? 0,
    stats,
    logs,
    hasRunBatch,
    setHasRunBatch,
    startConversion,
    togglePause,
    cancelConversion,
    canPause,
  };
}
