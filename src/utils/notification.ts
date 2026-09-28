/**
 * Client-Side Notification & Completion Sound Utility
 */

export function playCompletionChime(): void {
  try {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) return;
    const ctx = new AudioCtxClass();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0, now + idx * 0.12);
      gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.4);
    });
  } catch (e) {
    console.warn('Completion chime error:', e);
  }
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch (e) {
    console.warn('Notification permission request error:', e);
    return Notification.permission;
  }
}

export function notifyCompletion(title: string, message: string): void {
  playCompletionChime();

  const originalTitle = document.title;
  document.title = `[完了] ${title} | Universal Media Studio`;
  setTimeout(() => {
    document.title = originalTitle;
  }, 10000);

  if (isNotificationSupported() && Notification.permission === 'granted') {
    try {
      const options: any = {
        body: message,
        icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%232563eb"><circle cx="12" cy="12" r="10"/><path fill="%23ffffff" d="M9 12l2 2 4-4"/></svg>',
        tag: 'converter-job-done',
        renotify: true,
      };
      const notif = new Notification(title, options);
      notif.onclick = function () {
        window.focus();
        this.close();
      };
    } catch (e) {
      console.warn('Notification trigger error:', e);
    }
  }
}
