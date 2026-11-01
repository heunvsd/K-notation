/* A finite image sequence. The timer runs only while the current frame is visible. */
window.createImageSequencePlayer = function ({ count, interval, loadFrame, showFrame, onChange, onError }) {
  let index = -1;
  let playing = false;
  let ended = false;
  let pendingIndex = null;
  let loading = false;
  let request = 0;
  let timer = null;
  let due = 0;
  let remaining = interval;

  function state() { return { index, playing, ended, loading }; }
  function notify() { onChange(state()); }

  function schedule() {
    if (!playing) return;
    due = performance.now() + remaining;
    timer = setTimeout(() => {
      timer = null;
      if (index === count - 1) {
        playing = false;
        ended = true;
        notify();
      } else {
        display(index + 1);
      }
    }, remaining);
  }

  async function display(nextIndex) {
    const currentRequest = ++request;
    pendingIndex = nextIndex;
    loading = true;
    notify();
    try {
      const frame = await loadFrame(nextIndex);
      if (currentRequest !== request || !playing) return;
      showFrame(frame, nextIndex);
      index = nextIndex;
      pendingIndex = null;
      loading = false;
      remaining = interval;
      notify();
      schedule();
    } catch (error) {
      if (currentRequest !== request) return;
      playing = false;
      loading = false;
      notify();
      onError(error);
    }
  }

  function pause() {
    if (!playing) return;
    if (timer !== null) {
      remaining = Math.max(0, due - performance.now());
      clearTimeout(timer);
      timer = null;
    }
    ++request; // A late decode must never swap the image after pausing.
    playing = false;
    loading = false;
    notify();
  }

  function play() {
    if (playing) return;
    playing = true;
    if (ended) {
      ended = false;
      pendingIndex = 0;
    }
    if (pendingIndex !== null || index < 0) display(pendingIndex ?? 0);
    else { notify(); schedule(); }
  }

  return { play, pause, toggle: () => playing ? pause() : play(), state };
};
