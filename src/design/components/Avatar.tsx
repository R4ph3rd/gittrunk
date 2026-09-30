/* eslint-disable react-refresh/only-export-components */
import { useState, type HTMLAttributes } from "react";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Display name: initials and the accessible title. */
  name: string;
  /** Image URL (a data: URL from the backend); null/undefined or a load error shows initials. */
  src?: string | null;
  /** Pixel size, default 20. */
  size?: number;
  /** CSS color for the fallback disc and the optional ring, default "var(--accent)". Pass laneVar(n). */
  color?: string;
  /** 2px ring in `color` separated by --avatar-ring. */
  ring?: boolean;
}

/** Up to two uppercase letters: first letters of the first two words of `name`, else the first two characters of the email local part, else "?". */
export function initials(name: string): string {
  if (!name) return "?";

  // Try to extract email local part (before @)
  const emailMatch = name.match(/^([^@]+)/);
  if (!emailMatch || !emailMatch[1]) return "?";
  const localPart = emailMatch[1].trim();

  if (localPart) {
    // If it looks like an email (has @), use first two chars of local part
    if (name.includes("@")) {
      return localPart.slice(0, 2).toUpperCase().padEnd(2, "?");
    }
    // Otherwise treat as a display name: get first letters of first two words
    const words = localPart.split(/\s+/).filter((w) => w.length > 0);
    if (words.length >= 2) {
      const w0 = words[0] || "";
      const w1 = words[1] || "";
      const first = w0.length > 0 ? w0[0] : "";
      const second = w1.length > 0 ? w1[0] : "";
      const result = (first || "") + (second || "");
      return result.toUpperCase();
    }
    if (words.length === 1) {
      const w0 = words[0];
      return ((w0 && w0.slice(0, 2)) || "").toUpperCase().padEnd(2, "?");
    }
  }

  return "?";
}

export function Avatar({
  name,
  src,
  size = 20,
  color = "var(--accent)",
  ring,
  className,
  ...props
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);
  const showImage = !!src && !imageError;
  const initial = initials(name);
  const fontSize = Math.round(size * 0.42);
  const borderStyle = ring ? "2px solid var(--avatar-ring)" : "none";

  return (
    <span
      className={className}
      title={name}
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: color,
        border: borderStyle,
        boxSizing: "border-box",
        flexShrink: 0,
        overflow: "hidden",
        position: "relative",
      }}
      {...props}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          onError={() => setImageError(true)}
        />
      ) : (
        <span
          style={{
            fontSize: `${fontSize}px`,
            fontWeight: 600,
            color: "var(--lane-fg)",
            lineHeight: 1,
          }}
        >
          {initial}
        </span>
      )}
    </span>
  );
}
