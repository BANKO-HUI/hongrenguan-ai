import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const retryableRemovalCodes = new Set([
  'EACCES',
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'ENOTEMPTY',
  'EPERM',
]);

/**
 * Remove a task scratch directory without allowing a short-lived OS file lock
 * to change the task result. Windows Defender and image codecs can keep a file
 * handle open briefly after the generating process has finished.
 */
export async function removeTemporaryDirectory(
  directory,
  {
    remove = rm,
    wait = delay,
    retryDelays = [0, 80, 200, 500, 1000],
    warn = console.warn,
    scheduleDeferred = true,
  } = {},
) {
  let lastError;
  for (const retryDelay of retryDelays) {
    if (retryDelay) await wait(retryDelay);
    try {
      await remove(directory, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 100,
      });
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return true;
      lastError = error;
      if (!retryableRemovalCodes.has(error?.code)) break;
    }
  }

  warn?.(
    `任务临时目录暂时被系统占用，已延后清理（不会影响任务结果）：${lastError?.code || 'UNKNOWN'}`,
  );
  if (scheduleDeferred) {
    const timer = setTimeout(() => {
      void removeTemporaryDirectory(directory, {
        remove,
        wait,
        retryDelays: [0, 500, 1500],
        warn: null,
        scheduleDeferred: false,
      });
    }, 3000);
    timer.unref?.();
  }
  return false;
}
