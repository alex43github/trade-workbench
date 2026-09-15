export function detachTask(task, onError = () => undefined) {
  Promise.resolve(task).catch((error) => {
    try {
      onError(error);
    } catch {
      // Background error reporting must never create a second unhandled rejection.
    }
  });
}
