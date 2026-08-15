import { useEffect, useRef, useState } from 'react';
import { audioKey, audioUnits, audioUrl, listRecorded } from './audio.js';

/**
 * Reader-side narration: a ▶ button in the margin of every section the
 * author has read aloud. One shared <audio> element; clicking another
 * section switches to it.
 */
export function Narration({ slug }) {
  const [buttons, setButtons] = useState([]);
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let recordedSet = new Set();
    const measure = () => {
      setButtons(
        audioUnits()
          .map((el) => ({ el, key: audioKey(el) }))
          .filter((unit) => recordedSet.has(unit.key))
          .map((unit) => {
            const rect = unit.el.getBoundingClientRect();
            return {
              key: unit.key,
              top: rect.top + window.scrollY + 2,
              left: Math.max(8, rect.left - 34),
            };
          }),
      );
    };
    listRecorded(slug).then((recorded) => {
      if (cancelled) return;
      recordedSet = new Set(recorded);
      measure();
    });
    // Fonts can shift layout after first paint.
    const settle = setTimeout(measure, 600);
    window.addEventListener('resize', measure);
    return () => {
      cancelled = true;
      clearTimeout(settle);
      window.removeEventListener('resize', measure);
      audioRef.current?.pause();
    };
  }, [slug]);

  const toggle = (key) => {
    audioRef.current ??= new Audio();
    const player = audioRef.current;
    if (playing === key) {
      player.pause();
      setPlaying(null);
      return;
    }
    player.src = audioUrl(slug, key);
    player.onended = () => setPlaying(null);
    player.play();
    setPlaying(key);
  };

  if (!buttons.length) return null;
  return (
    <div className="narration-layer">
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          className={`narration-btn${playing === b.key ? ' playing' : ''}`}
          style={{ top: b.top, left: b.left }}
          aria-label={playing === b.key ? 'Pause narration' : 'Play narration for this section'}
          onClick={() => toggle(b.key)}
        >
          {playing === b.key ? '⏸' : '▶'}
        </button>
      ))}
    </div>
  );
}
