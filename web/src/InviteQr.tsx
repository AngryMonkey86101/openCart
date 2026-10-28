import { useEffect, useMemo, useState } from "react";
import { encode } from "uqr";
import type { Family } from "./api";
import { copyText, haptic, notifyHaptic, shareLink, showBackButton } from "./telegram";

// Тип модуля «поисковый узор» (квадраты в углах) в uqr, рисуем его отдельно скруглёнными рамками.
const POSITION = 2;

/** Экран приглашения в стиле «Поделиться профилем» Telegram: крупный QR-код ссылки и кнопки под ним. */
export function InviteQr({ family, onClose }: { family: Family; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => showBackButton(onClose), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    if (await copyText(family.inviteLink)) {
      notifyHaptic();
      setCopied(true);
    }
  }

  function share() {
    haptic();
    shareLink(family.inviteLink, `Присоединяйся к нашему списку покупок «${family.name}»`);
  }

  return (
    <div className="invite" role="dialog" aria-modal="true" aria-label="Приглашение в список">
      <button className="icon invite-close" onClick={onClose} aria-label="Закрыть">
        ✕
      </button>
      <div className="invite-body">
        <div className="qr-card">
          <div className="qr-badge" aria-hidden="true">
            <span className="logo" />
          </div>
          <QrCode value={family.inviteLink} />
          <p className="qr-name">{family.name}</p>
        </div>
        <p className="invite-hint">
          Наведите камеру телефона на код или отправьте ссылку, чтобы присоединиться к списку.
        </p>
      </div>
      <div className="invite-actions">
        <button className="block" onClick={share}>
          Поделиться ссылкой
        </button>
        <button className="block outline" onClick={copy}>
          {copied ? "Ссылка скопирована ✓" : "Скопировать ссылку"}
        </button>
      </div>
    </div>
  );
}

/** QR-код со скруглёнными точками и пустым местом под логотип в центре. Генерируется в браузере. */
function QrCode({ value }: { value: string }) {
  const { size, dots, finders, hole } = useMemo(() => {
    // Уровень Q выдерживает потерю 25% кода, логотип в центре закрывает около 5%.
    const qr = encode(value, { ecc: "Q", border: 0 });
    const size = qr.size;
    let hole = Math.round(size * 0.24);
    if (hole % 2 !== size % 2) hole += 1;
    const from = (size - hole) / 2;
    const inHole = (x: number, y: number) => x >= from && x < from + hole && y >= from && y < from + hole;

    const dots: string[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.data[y][x] && qr.types[y][x] !== POSITION && !inHole(x, y)) dots.push(`${x},${y}`);
      }
    }
    const finders = [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ];
    return { size, dots, finders, hole: { from, size: hole } };
  }, [value]);

  // Логотип кладём поверх SVG обычным блоком: foreignObject в webview iOS рисуется со сдвигом.
  const logo = `${((hole.size - 1) / (size + 2)) * 100}%`;
  return (
    <div className="qr">
      <svg viewBox={`-1 -1 ${size + 2} ${size + 2}`} role="img" aria-label="QR-код приглашения">
        <g className="qr-dots">
          {dots.map((d) => {
            const [x, y] = d.split(",").map(Number);
            return <rect key={d} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} rx={0.36} />;
          })}
        </g>
        {finders.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <rect className="qr-ring" x={x + 0.5} y={y + 0.5} width={6} height={6} rx={2} />
            <rect className="qr-eye" x={x + 2} y={y + 2} width={3} height={3} rx={1} />
          </g>
        ))}
      </svg>
      <span className="qr-logo" style={{ width: logo, height: logo }} aria-hidden="true" />
    </div>
  );
}
