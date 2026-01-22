import React, { useMemo } from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
  AbsoluteFill,
  random,
} from "remotion";

// Colors
const COLORS = {
  black: "#0a0a0a",
  white: "#f0f0f0",
  gray: "#555",
  lightGray: "#888",
  green: "#4ade80",
};

// C logo pixel positions (relative to center, in a grid)
const C_LOGO_PIXELS = [
  // Top row
  { x: 0, y: -3 }, { x: 1, y: -3 }, { x: 2, y: -3 },
  // Upper left
  { x: -1, y: -2 }, { x: -2, y: -1 }, { x: -2, y: 0 }, { x: -2, y: 1 },
  // Lower left
  { x: -1, y: 2 },
  // Bottom row
  { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
  // Fill pixels for thickness
  { x: -1, y: -1 }, { x: -1, y: 0 }, { x: -1, y: 1 },
  { x: 0, y: -2 }, { x: 1, y: -2 },
  { x: 0, y: 2 }, { x: 1, y: 2 },
];

// Terminal corner positions (where pixels will land)
const TERMINAL_TARGETS = {
  topLeft: { x: 15, y: 25 },
  topRight: { x: 85, y: 25 },
  bottomLeft: { x: 15, y: 75 },
  bottomRight: { x: 85, y: 75 },
  // Border positions
  top: [20, 30, 40, 50, 60, 70, 80].map(x => ({ x, y: 25 })),
  bottom: [20, 30, 40, 50, 60, 70, 80].map(x => ({ x, y: 75 })),
  left: [35, 45, 55, 65].map(y => ({ x: 15, y })),
  right: [35, 45, 55, 65].map(y => ({ x: 85, y })),
};

// Generate pixels with C logo starting positions and terminal targets
const generateLogoPixels = (seed: string) => {
  const allTargets = [
    TERMINAL_TARGETS.topLeft,
    TERMINAL_TARGETS.topRight,
    TERMINAL_TARGETS.bottomLeft,
    TERMINAL_TARGETS.bottomRight,
    ...TERMINAL_TARGETS.top,
    ...TERMINAL_TARGETS.bottom,
    ...TERMINAL_TARGETS.left,
    ...TERMINAL_TARGETS.right,
  ];

  return C_LOGO_PIXELS.map((pos, i) => {
    const target = allTargets[i % allTargets.length];
    return {
      id: i,
      // Start position (C logo, centered)
      startX: 50 + pos.x * 4,
      startY: 50 + pos.y * 4,
      // Target position (terminal outline)
      targetX: target.x + (random(`${seed}-jitter-x-${i}`) - 0.5) * 3,
      targetY: target.y + (random(`${seed}-jitter-y-${i}`) - 0.5) * 3,
      size: 12 + random(`${seed}-size-${i}`) * 6,
      delay: random(`${seed}-delay-${i}`) * 8,
      // Explosion trajectory (outward burst before going to target)
      burstX: (random(`${seed}-burst-x-${i}`) - 0.5) * 60,
      burstY: (random(`${seed}-burst-y-${i}`) - 0.5) * 60,
    };
  });
};

// Extra ambient pixels for visual interest
const generateAmbientPixels = (count: number, seed: string) => {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: random(`${seed}-x-${i}`) * 100,
    y: random(`${seed}-y-${i}`) * 100,
    size: 3 + random(`${seed}-size-${i}`) * 5,
    opacity: 0.05 + random(`${seed}-op-${i}`) * 0.1,
  }));
};

// Scene 1: C Logo forms and pulses
const CLogoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pixels = useMemo(() => generateLogoPixels("logo"), []);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black }}>
      {pixels.map((pixel) => {
        // Fade in with stagger
        const fadeIn = interpolate(
          frame,
          [pixel.delay, pixel.delay + 10],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        // Subtle pulse
        const pulse = 1 + Math.sin(frame * 0.15 + pixel.delay) * 0.1;

        // Flicker effect for energy
        const flicker = frame > 25 ? (Math.sin(frame * 0.8 + pixel.id) > 0.3 ? 1 : 0.7) : 1;

        return (
          <div
            key={pixel.id}
            style={{
              position: "absolute",
              left: `${pixel.startX}%`,
              top: `${pixel.startY}%`,
              width: pixel.size * pulse,
              height: pixel.size * pulse,
              backgroundColor: COLORS.white,
              opacity: fadeIn * flicker,
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// Scene 2: C explodes and pixels travel to form terminal
const ExplodeToTerminal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pixels = useMemo(() => generateLogoPixels("logo"), []);

  // Phase 1: Explosion (frames 0-20)
  // Phase 2: Travel to terminal positions (frames 20-50)

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black }}>
      {pixels.map((pixel) => {
        // Explosion phase
        const explosionProgress = spring({
          frame: frame,
          fps,
          config: { damping: 8, stiffness: 100 },
          durationInFrames: 20,
        });

        // Travel to target phase
        const travelProgress = spring({
          frame: Math.max(0, frame - 15),
          fps,
          config: { damping: 20, stiffness: 60 },
        });

        // Position calculation
        // Start → Burst outward → Travel to terminal position
        const burstX = pixel.startX + pixel.burstX * explosionProgress;
        const burstY = pixel.startY + pixel.burstY * explosionProgress;

        const currentX = interpolate(travelProgress, [0, 1], [burstX, pixel.targetX]);
        const currentY = interpolate(travelProgress, [0, 1], [burstY, pixel.targetY]);

        // Size shrinks as it travels
        const size = interpolate(travelProgress, [0, 1], [pixel.size, pixel.size * 0.5]);

        // Fade slightly during travel
        const opacity = interpolate(travelProgress, [0, 0.5, 1], [1, 0.8, 0.6]);

        return (
          <div
            key={pixel.id}
            style={{
              position: "absolute",
              left: `${currentX}%`,
              top: `${currentY}%`,
              width: size,
              height: size,
              backgroundColor: COLORS.white,
              opacity,
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// Scene 3: Terminal fades in with pixels as glow, then commands type
const TerminalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pixels = useMemo(() => generateLogoPixels("logo"), []);
  const ambientPixels = useMemo(() => generateAmbientPixels(40, "ambient"), []);

  const commands = [
    { text: "send 10 USDC to vitalik.eth", start: 30 },
    { text: "deposit 500 USDC for 8% APY", start: 85 },
    { text: "swap 0.5 ETH → USDC", start: 140 },
  ];

  // Terminal fade in
  const terminalOpacity = interpolate(frame, [0, 25], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Pixels fade out as terminal solidifies
  const pixelOpacity = interpolate(frame, [0, 40], [0.5, 0.08], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.black,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {/* Ambient pixels at edges */}
      {ambientPixels.map((pixel) => (
        <div
          key={`amb-${pixel.id}`}
          style={{
            position: "absolute",
            left: `${pixel.x < 50 ? pixel.x * 0.3 : 70 + pixel.x * 0.3}%`,
            top: `${pixel.y < 50 ? pixel.y * 0.3 : 70 + pixel.y * 0.3}%`,
            width: pixel.size,
            height: pixel.size,
            backgroundColor: COLORS.white,
            opacity: pixel.opacity,
          }}
        />
      ))}

      {/* Logo pixels forming terminal glow */}
      {pixels.map((pixel) => (
        <div
          key={pixel.id}
          style={{
            position: "absolute",
            left: `${pixel.targetX}%`,
            top: `${pixel.targetY}%`,
            width: pixel.size * 0.5,
            height: pixel.size * 0.5,
            backgroundColor: COLORS.white,
            opacity: pixelOpacity,
            transform: "translate(-50%, -50%)",
            filter: "blur(2px)",
          }}
        />
      ))}

      {/* Terminal window */}
      <div
        style={{
          opacity: terminalOpacity,
          width: "75%",
          maxWidth: 750,
        }}
      >
        <div
          style={{
            backgroundColor: "#0d0d0d",
            borderRadius: 12,
            border: "1px solid #1a1a1a",
            overflow: "hidden",
            boxShadow: "0 0 60px rgba(255,255,255,0.03)",
          }}
        >
          {/* Terminal header */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #1a1a1a",
              display: "flex",
              gap: 8,
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#ff5f56" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#ffbd2e" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "#27ca40" }} />
          </div>

          {/* Terminal content */}
          <div style={{ padding: "28px 32px" }}>
            {commands.map((cmd, i) => {
              const lineOpacity = interpolate(
                frame,
                [cmd.start, cmd.start + 8],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );

              // Typewriter
              const charsPerFrame = 1;
              const charsToShow = Math.floor(Math.max(0, frame - cmd.start - 8) * charsPerFrame);
              const displayText = cmd.text.slice(0, charsToShow);
              const isTyping = charsToShow < cmd.text.length && charsToShow > 0;
              const cursorBlink = Math.floor(frame / 8) % 2 === 0;

              // Checkmark
              const typingDone = charsToShow >= cmd.text.length;
              const checkOpacity = typingDone
                ? interpolate(
                    frame,
                    [cmd.start + cmd.text.length + 15, cmd.start + cmd.text.length + 25],
                    [0, 1],
                    { extrapolateRight: "clamp" }
                  )
                : 0;

              return (
                <div
                  key={i}
                  style={{
                    opacity: lineOpacity,
                    marginBottom: 24,
                    fontSize: 21,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span style={{ color: COLORS.green }}>❯</span>
                  <span style={{ color: COLORS.white }}>
                    {displayText}
                    {isTyping && cursorBlink && (
                      <span style={{ opacity: 0.8 }}>▋</span>
                    )}
                  </span>
                  <span
                    style={{
                      color: COLORS.green,
                      opacity: checkOpacity,
                      marginLeft: 8,
                    }}
                  >
                    ✓
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Ambient background for later scenes
const AmbientPixels: React.FC<{ opacity?: number }> = ({ opacity = 0.08 }) => {
  const pixels = useMemo(() => generateAmbientPixels(50, "ambient-bg"), []);

  return (
    <>
      {pixels.map((pixel) => (
        <div
          key={pixel.id}
          style={{
            position: "absolute",
            left: `${pixel.x < 50 ? pixel.x * 0.35 : 65 + pixel.x * 0.35}%`,
            top: `${pixel.y < 50 ? pixel.y * 0.35 : 65 + pixel.y * 0.35}%`,
            width: pixel.size,
            height: pixel.size,
            backgroundColor: COLORS.white,
            opacity: opacity * pixel.opacity * 10,
          }}
        />
      ))}
    </>
  );
};

// Scene 4: Thesis
const ThesisScene: React.FC = () => {
  const frame = useCurrentFrame();

  const words = "Keys should be as universal as code.".split(" ");
  const framesPerWord = 7;

  const containerOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.black,
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
      }}
    >
      <AmbientPixels opacity={0.06} />

      <div
        style={{
          opacity: containerOpacity,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "14px 18px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 50,
          fontWeight: 700,
          color: COLORS.white,
          textAlign: "center",
          lineHeight: 1.35,
          maxWidth: 880,
        }}
      >
        {words.map((word, i) => {
          const wordStart = 20 + i * framesPerWord;
          const opacity = interpolate(frame, [wordStart, wordStart + 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const translateY = interpolate(frame, [wordStart, wordStart + 12], [25, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <span
              key={i}
              style={{
                opacity,
                transform: `translateY(${translateY}px)`,
                display: "inline-block",
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Pixel logo component
const PixelLogo: React.FC<{ size?: number }> = ({ size = 80 }) => {
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 5 6">
      <rect x="3" y="0" width="2" height="1" fill="#fff" />
      <rect x="1" y="1" width="1" height="1" fill="#888" />
      <rect x="2" y="1" width="1" height="1" fill="#888" />
      <rect x="3" y="1" width="1" height="1" fill="#666" />
      <rect x="1" y="2" width="1" height="1" fill="#888" />
      <rect x="1" y="3" width="1" height="1" fill="#888" />
      <rect x="1" y="4" width="1" height="1" fill="#888" />
      <rect x="2" y="4" width="1" height="1" fill="#888" />
      <rect x="3" y="4" width="1" height="1" fill="#666" />
    </svg>
  );
};

// Scene 5: Clara Brand
const BrandScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 12 },
  });

  const nameOpacity = interpolate(frame, [15, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  const taglineOpacity = interpolate(frame, [40, 55], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.black,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <AmbientPixels opacity={0.05} />

      <div style={{ textAlign: "center" }}>
        <div style={{ transform: `scale(${logoScale})`, marginBottom: 28 }}>
          <PixelLogo size={100} />
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 700,
            color: COLORS.white,
            opacity: nameOpacity,
            letterSpacing: "-0.02em",
          }}
        >
          Clara
        </div>
        <div
          style={{
            fontSize: 26,
            color: COLORS.lightGray,
            marginTop: 18,
            opacity: taglineOpacity,
          }}
        >
          A wallet for Claude Code
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Main composition - 15 seconds total
export const ClaraExplainer: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black }}>
      {/* Scene 1: C Logo forms (0-40 frames = 0-1.3s) */}
      <Sequence from={0} durationInFrames={40}>
        <CLogoScene />
      </Sequence>

      {/* Scene 2: Explode to terminal (40-100 frames = 1.3-3.3s) */}
      <Sequence from={40} durationInFrames={60}>
        <ExplodeToTerminal />
      </Sequence>

      {/* Scene 3: Terminal with commands (100-300 frames = 3.3-10s) */}
      <Sequence from={100} durationInFrames={200}>
        <TerminalScene />
      </Sequence>

      {/* Scene 4: Thesis (300-390 frames = 10-13s) */}
      <Sequence from={300} durationInFrames={90}>
        <ThesisScene />
      </Sequence>

      {/* Scene 5: Brand (390-450 frames = 13-15s) */}
      <Sequence from={390} durationInFrames={60}>
        <BrandScene />
      </Sequence>
    </AbsoluteFill>
  );
};
