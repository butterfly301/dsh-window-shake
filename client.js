window.__ModuleLoader__.load({
  id: 'dsh-window-shake',
  factory() {
    const NS = 'dsh-window-shake';
    const EVENT_NAME = 'dsh:window-shake';
    const SAMPLE_MS = 50; // ~20 Hz
    const WINDOW_MS = 1200;
    const MIN_REVERSALS = 3;
    const MIN_DISPLACEMENT_PX = 150;
    const MIN_STEP_PX = 3;
    const DEFAULT_COOLDOWN_MS = 60_000;
    const MIN_COOLDOWN_MS = 1000;

    function isReducedMotion() {
      try {
        return typeof window !== 'undefined'
          && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    }

    function isDesktopHost() {
      if (typeof window === 'undefined' || typeof window.screenX !== 'number') return false;
      try {
        const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
        if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return false;
      } catch {}
      return true;
    }

    function normalizeCooldown(raw) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_COOLDOWN_MS;
      return Math.max(MIN_COOLDOWN_MS, Math.round(raw));
    }

    function createShakeDetector({
      windowMs = WINDOW_MS,
      minReversals = MIN_REVERSALS,
      minDisplacementPx = MIN_DISPLACEMENT_PX,
      minStepPx = MIN_STEP_PX,
      cooldownMs = DEFAULT_COOLDOWN_MS,
    } = {}) {
      let currentCooldownMs = normalizeCooldown(cooldownMs);
      let lastX = null;
      let lastWidth = null;
      let lastHeight = null;
      let lastTriggeredAt = -Infinity;
      const samples = [];

      function reset() {
        samples.length = 0;
        lastX = null;
      }

      function setCooldownMs(nextMs) {
        currentCooldownMs = normalizeCooldown(nextMs);
      }

      function sample({ x, width = null, height = null, now = Date.now() }) {
        if (!Number.isFinite(x)) return null;
        if (width !== null && height !== null) {
          if (lastWidth !== null && lastHeight !== null && (width !== lastWidth || height !== lastHeight)) {
            lastWidth = width;
            lastHeight = height;
            reset();
            lastX = x;
            return null;
          }
          lastWidth = width;
          lastHeight = height;
        }
        if (lastX === null) {
          lastX = x;
          return null;
        }

        const dx = x - lastX;
        lastX = x;
        if (Math.abs(dx) < minStepPx) return null;

        samples.push({
          dir: dx > 0 ? 1 : -1,
          dist: Math.abs(dx),
          at: now,
        });

        while (samples.length > 0 && now - samples[0].at > windowMs) {
          samples.shift();
        }

        if (now - lastTriggeredAt < currentCooldownMs) return null;

        let totalDist = 0;
        let reversals = 0;
        let prevDir = 0;
        for (const item of samples) {
          totalDist += item.dist;
          if (prevDir !== 0 && item.dir !== prevDir) {
            reversals += 1;
          }
          prevDir = item.dir;
        }

        if (reversals >= minReversals && totalDist >= minDisplacementPx) {
          lastTriggeredAt = now;
          samples.length = 0;
          return {
            at: now,
            intensity: 1,
            durationMs: 4000,
            reversals,
            displacementPx: totalDist,
          };
        }
        return null;
      }

      return { sample, reset, setCooldownMs };
    }

    return {
      inject: ['configForms'],
      apply(ctx) {
        return ctx.effect(() => {
          if (!isDesktopHost()) return undefined;

          let timer = 0;
          let enabled = true;
          const detector = createShakeDetector();

          const stopPolling = () => {
            if (timer !== 0) {
              clearInterval(timer);
              timer = 0;
            }
            detector.reset();
          };

          const startPolling = () => {
            if (timer !== 0 || !enabled || isReducedMotion()) return;
            timer = setInterval(() => {
              if (typeof document !== 'undefined' && document.hidden) return;
              const hit = detector.sample({
                x: window.screenX,
                width: window.innerWidth,
                height: window.innerHeight,
                now: Date.now(),
              });
              if (hit && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: hit }));
              }
            }, SAMPLE_MS);
          };

          const syncState = () => {
            if (enabled && !isReducedMotion()) startPolling();
            else stopPolling();
          };

          const applyConfigValue = (value) => {
            if (!value || typeof value !== 'object') {
              enabled = true;
              detector.setCooldownMs(DEFAULT_COOLDOWN_MS);
            } else {
              enabled = value.enabled !== false;
              detector.setCooldownMs(value.cooldownMs);
            }
            syncState();
          };

          const bindConfigForm = (configForms) => {
            if (!configForms || typeof configForms.get !== 'function') return () => {};
            const form = configForms.get(NS);
            if (!form) return () => {};
            const update = () => {
              const snap = form.getSnapshot?.();
              if (!snap || snap.status === 'loading') return;
              if (snap.status === 'ready') applyConfigValue(snap.value);
              else applyConfigValue(null);
            };
            const unsub = typeof form.subscribe === 'function' ? form.subscribe(update) : undefined;
            update();
            return () => { try { unsub?.(); } catch {} };
          };

          const stopForm = bindConfigForm(ctx.configForms);

          const mq = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
          const onMotionChange = () => syncState();

          if (mq && typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', onMotionChange);
          }

          syncState();

          return () => {
            if (mq && typeof mq.removeEventListener === 'function') {
              mq.removeEventListener('change', onMotionChange);
            }
            try { stopForm?.(); } catch {}
            stopPolling();
          };
        }, 'dsh-window-shake: monitor');
      },
    };
  },
});
