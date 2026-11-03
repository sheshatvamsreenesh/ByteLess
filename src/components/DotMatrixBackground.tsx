/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';

const HAND_IMAGE_URL =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261030_025250_100df7b8-31fd-4614-aa4a-c1b7d5b6b273.png&w=1600&q=85';

// Normalized 2x2 crop coordinates from Kindred specification
// [normX, normY, normW, normH]
const CROPS = {
  LA: [0.0, 0.06, 0.47, 0.40],
  RA: [0.53, 0.06, 0.47, 0.40],
  LB: [0.0, 0.55, 0.47, 0.40],
  RB: [0.53, 0.55, 0.47, 0.40],
};

export const DotMatrixBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId: number;
    let isDestroyed = false;

    // Accessibility check: prefers-reduced-motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const prefersReducedMotion = mediaQuery.matches;

    // 4 Cropped Hand Sprites (LA, RA, LB, RB)
    let cropLA: HTMLCanvasElement | null = null;
    let cropRA: HTMLCanvasElement | null = null;
    let cropLB: HTMLCanvasElement | null = null;
    let cropRB: HTMLCanvasElement | null = null;

    // Offscreen Pose Canvases for Pose A and Pose B
    const poseCanvasA = document.createElement('canvas');
    const poseCanvasB = document.createElement('canvas');
    const poseCtxA = poseCanvasA.getContext('2d', { willReadFrequently: true });
    const poseCtxB = poseCanvasB.getContext('2d', { willReadFrequently: true });

    let imageReady = false;

    // Load source image with crossOrigin="anonymous" BEFORE setting src
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (isDestroyed) return;
      try {
        const nw = img.naturalWidth || 1600;
        const nh = img.naturalHeight || 905;

        const makeCrop = (rect: number[]) => {
          const sx = Math.floor(rect[0] * nw);
          const sy = Math.floor(rect[1] * nh);
          const sw = Math.floor(rect[2] * nw);
          const sh = Math.floor(rect[3] * nh);

          const c = document.createElement('canvas');
          c.width = sw;
          c.height = sh;
          const cCtx = c.getContext('2d');
          if (cCtx) {
            cCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          }
          return c;
        };

        cropLA = makeCrop(CROPS.LA);
        cropRA = makeCrop(CROPS.RA);
        cropLB = makeCrop(CROPS.LB);
        cropRB = makeCrop(CROPS.RB);

        imageReady = true;
      } catch (err) {
        console.error('Error cropping hand regions into offscreen canvases:', err);
        setHasError(true);
      }
    };

    img.onerror = (err) => {
      console.warn('Could not load hand source image, utilizing procedural fallback.', err);
      setHasError(true);
    };

    img.src = HAND_IMAGE_URL;

    // Handle visible canvas sizing
    const handleResize = () => {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = window.innerWidth;
      const height = window.innerHeight;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.scale(dpr, dpr);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const startTime = performance.now();

    // Timing parameters for independent transitions
    const LEFT_CYCLE = 7200; // ms
    const RIGHT_CYCLE = 7800; // ms (slightly staggered for organic decoupling)
    const TRANSITION_DURATION = 1400; // ms dissolve duration

    // Deterministic dot hash for glitch dissolve
    const getDotHash = (col: number, row: number, poseId: number, handId: number) => {
      const n = col * 374761393 + row * 668265263 + poseId * 1274126177 + handId * 827412619;
      const hashed = ((n ^ (n >> 13)) * 1274126177) >>> 0;
      return (hashed % 10000) / 10000;
    };

    const render = (now: number) => {
      if (isDestroyed) return;

      const elapsed = prefersReducedMotion ? 0 : now - startTime;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isMobile = width < 768;

      // Fill visible canvas with warm off-white background
      ctx.fillStyle = '#f7f7f5';
      ctx.fillRect(0, 0, width, height);

      // Dot-matrix grid step (pitch)
      const step = isMobile ? 8.5 : 9.5;
      const gridCols = Math.ceil(width / step);
      const gridRows = Math.ceil(height / step);

      // Sizing of intermediate sampling pose canvases (at 2x grid resolution for sub-pixel fidelity)
      const poseW = gridCols * 2;
      const poseH = gridRows * 2;

      if (poseCanvasA.width !== poseW || poseCanvasA.height !== poseH) {
        poseCanvasA.width = poseW;
        poseCanvasA.height = poseH;
        poseCanvasB.width = poseW;
        poseCanvasB.height = poseH;
      }

      // Proportions and positioning for TWO distinct hands reaching towards each other
      // Aspect ratio of the hand crops is 0.47 / 0.40 * (1600 / 905) ≈ 2.077
      const handAspect = 2.077;
      let handW: number;
      let handH: number;
      let centerY: number;
      let leftBaseX: number;
      let leftBaseY: number;
      let rightBaseX: number;
      let rightBaseY: number;

      // Small responsive downward translation (approx 35-50px on desktop)
      // to naturally frame the headline while keeping the entire continuous dot pattern intact
      const downwardShift = isMobile
        ? Math.round(height * 0.035)
        : Math.round(Math.min(Math.max(height * 0.048, 35), 48));

      if (isMobile) {
        // Mobile layout: hands scale nicely and enter from the edges, meeting near center
        handW = Math.max(width * 0.65, 310);
        handH = handW / handAspect;
        centerY = height * 0.45 + downwardShift;

        // Left hand anchored to left edge, forearm extends off-screen
        leftBaseX = -handW * 0.28;
        leftBaseY = centerY - handH * 0.5;

        // Right hand anchored to right edge, forearm extends off-screen
        rightBaseX = width - handW * 0.72;
        rightBaseY = centerY - handH * 0.5;
      } else {
        // Desktop layout: left hand occupies ~left half, right hand occupies ~right half
        handW = Math.min(width * 0.49, 780);
        handH = handW / handAspect;
        centerY = height * 0.46 + downwardShift;

        // Left hand enters from left edge, fingertips reach to ~43% width
        leftBaseX = -handW * 0.08;
        leftBaseY = centerY - handH * 0.5;

        // Right hand enters from right edge, fingertips reach to ~57% width
        // Leaving ~14% natural gap between fingertips in the center
        rightBaseX = width - handW * 0.92;
        rightBaseY = centerY - handH * 0.5;
      }

      // Independent organic drift & breathing for Left Hand
      const leftDriftX = prefersReducedMotion
        ? 0
        : Math.sin(elapsed * 0.00035) * 12 + Math.sin(elapsed * 0.00085) * 5;
      const leftDriftY = prefersReducedMotion
        ? 0
        : Math.cos(elapsed * 0.00042) * 8 + Math.cos(elapsed * 0.00072) * 4;
      const leftScale = prefersReducedMotion ? 1 : 1 + Math.sin(elapsed * 0.00028) * 0.015;
      const leftRot = prefersReducedMotion ? 0 : Math.sin(elapsed * 0.00018) * 0.012;

      // Independent organic drift & breathing for Right Hand (independent phase & frequencies)
      const rightDriftX = prefersReducedMotion
        ? 0
        : Math.sin(elapsed * 0.00031 + 2.1) * 12 + Math.sin(elapsed * 0.00078 + 1.4) * 5;
      const rightDriftY = prefersReducedMotion
        ? 0
        : Math.cos(elapsed * 0.00038 + 1.6) * 8 + Math.cos(elapsed * 0.00065 + 2.7) * 4;
      const rightScale = prefersReducedMotion ? 1 : 1 + Math.sin(elapsed * 0.00024 + 1.8) * 0.015;
      const rightRot = prefersReducedMotion ? 0 : Math.sin(elapsed * 0.00019 + 2.3) * 0.012;

      // Scale factors to map screen positions into pose canvas (2x grid resolution)
      const scaleX = poseW / width;
      const scaleY = poseH / height;

      // Left hand coordinates on pose canvases
      const lPosX = (leftBaseX + leftDriftX) * scaleX;
      const lPosY = (leftBaseY + leftDriftY) * scaleY;
      const lWidth = handW * leftScale * scaleX;
      const lHeight = handH * leftScale * scaleY;

      // Right hand coordinates on pose canvases
      const rPosX = (rightBaseX + rightDriftX) * scaleX;
      const rPosY = (rightBaseY + rightDriftY) * scaleY;
      const rWidth = handW * rightScale * scaleX;
      const rHeight = handH * rightScale * scaleY;

      let dataA: Uint8ClampedArray | null = null;
      let dataB: Uint8ClampedArray | null = null;

      if (imageReady && cropLA && cropRA && cropLB && cropRB && poseCtxA && poseCtxB) {
        // Step 1: Clear offscreen pose canvases with white (#ffffff)
        poseCtxA.fillStyle = '#ffffff';
        poseCtxA.fillRect(0, 0, poseW, poseH);
        poseCtxB.fillStyle = '#ffffff';
        poseCtxB.fillRect(0, 0, poseW, poseH);

        // Use 'multiply' blend mode so neither hand's white bounding box overwrites the other
        poseCtxA.globalCompositeOperation = 'multiply';
        poseCtxB.globalCompositeOperation = 'multiply';

        // Step 2: Draw Left Hand Pose A (LA) into Left-hand position on Pose Canvas A
        poseCtxA.save();
        poseCtxA.translate(lPosX + lWidth / 2, lPosY + lHeight / 2);
        poseCtxA.rotate(leftRot);
        poseCtxA.drawImage(cropLA, -lWidth / 2, -lHeight / 2, lWidth, lHeight);
        poseCtxA.restore();

        // Step 3: Draw Right Hand Pose A (RA) into Right-hand position on Pose Canvas A
        poseCtxA.save();
        poseCtxA.translate(rPosX + rWidth / 2, rPosY + rHeight / 2);
        poseCtxA.rotate(rightRot);
        poseCtxA.drawImage(cropRA, -rWidth / 2, -rHeight / 2, rWidth, rHeight);
        poseCtxA.restore();

        // Step 4: Draw Left Hand Pose B (LB) into Left-hand position on Pose Canvas B
        poseCtxB.save();
        poseCtxB.translate(lPosX + lWidth / 2, lPosY + lHeight / 2);
        poseCtxB.rotate(leftRot);
        poseCtxB.drawImage(cropLB, -lWidth / 2, -lHeight / 2, lWidth, lHeight);
        poseCtxB.restore();

        // Step 5: Draw Right Hand Pose B (RB) into Right-hand position on Pose Canvas B
        poseCtxB.save();
        poseCtxB.translate(rPosX + rWidth / 2, rPosY + rHeight / 2);
        poseCtxB.rotate(rightRot);
        poseCtxB.drawImage(cropRB, -rWidth / 2, -rHeight / 2, rWidth, rHeight);
        poseCtxB.restore();

        // Reset blend mode
        poseCtxA.globalCompositeOperation = 'source-over';
        poseCtxB.globalCompositeOperation = 'source-over';

        // Retrieve pixel data of both composite fields
        dataA = poseCtxA.getImageData(0, 0, poseW, poseH).data;
        dataB = poseCtxB.getImageData(0, 0, poseW, poseH).data;
      }

      // Step 6: Sample pose fields and render dot-matrix halftone onto visible canvas
      // Independent pose-transition calculations for Left and Right hands
      const leftTimeInCycle = elapsed % LEFT_CYCLE;
      const leftIsTransitioning =
        !prefersReducedMotion && leftTimeInCycle > LEFT_CYCLE - TRANSITION_DURATION;
      const leftProgress = leftIsTransitioning
        ? (leftTimeInCycle - (LEFT_CYCLE - TRANSITION_DURATION)) / TRANSITION_DURATION
        : 0;
      const leftCycleIndex = Math.floor(elapsed / LEFT_CYCLE);
      const leftPose = leftCycleIndex % 2 === 0 ? 'A' : 'B';

      // Right hand has independent timing offset by 3400ms
      const rightElapsed = elapsed + 3400;
      const rightTimeInCycle = rightElapsed % RIGHT_CYCLE;
      const rightIsTransitioning =
        !prefersReducedMotion && rightTimeInCycle > RIGHT_CYCLE - TRANSITION_DURATION;
      const rightProgress = rightIsTransitioning
        ? (rightTimeInCycle - (RIGHT_CYCLE - TRANSITION_DURATION)) / TRANSITION_DURATION
        : 0;
      const rightCycleIndex = Math.floor(rightElapsed / RIGHT_CYCLE);
      const rightPose = rightCycleIndex % 2 === 0 ? 'A' : 'B';

      // Scanline glitch row displacement calculation
      const glitchCycle = Math.sin(elapsed * 0.0018);
      const hasRowGlitch = !prefersReducedMotion && glitchCycle > 0.88;
      const glitchSeed = Math.floor(elapsed * 0.02);

      const maxDotRadius = step * 0.44;

      ctx.beginPath();
      ctx.fillStyle = '#0d0d0d';

      for (let r = 0; r < gridRows; r++) {
        const dotY = r * step;

        // Occasional horizontal scanline row displacement
        let rowShiftX = 0;
        if (hasRowGlitch && (r + glitchSeed) % 9 === 0) {
          rowShiftX = Math.sin(r * 2.5 + elapsed * 0.05) * 6;
        }

        for (let c = 0; c < gridCols; c++) {
          const dotX = c * step + rowShiftX;
          const isLeftRegion = dotX < width * 0.5;

          // Determine target pose and glitch dissolve for this dot
          let targetPose: 'A' | 'B';
          let isGlitchEdge = false;

          if (isLeftRegion) {
            if (leftIsTransitioning) {
              const hash = getDotHash(c, r, leftCycleIndex, 0);
              const nextPose = leftPose === 'A' ? 'B' : 'A';
              targetPose = hash < leftProgress ? nextPose : leftPose;
              if (Math.abs(hash - leftProgress) < 0.04) {
                isGlitchEdge = true;
              }
            } else {
              targetPose = leftPose;
            }
          } else {
            if (rightIsTransitioning) {
              const hash = getDotHash(c, r, rightCycleIndex, 1);
              const nextPose = rightPose === 'A' ? 'B' : 'A';
              targetPose = hash < rightProgress ? nextPose : rightPose;
              if (Math.abs(hash - rightProgress) < 0.04) {
                isGlitchEdge = true;
              }
            } else {
              targetPose = rightPose;
            }
          }

          let darkness = 0;

          if (dataA && dataB) {
            const data = targetPose === 'A' ? dataA : dataB;
            // Map grid (c, r) into pose canvas coordinates (2x resolution)
            const sampleX = Math.min(poseW - 1, c * 2);
            const sampleY = Math.min(poseH - 1, r * 2);
            const idx = (sampleY * poseW + sampleX) * 4;

            const rVal = data[idx];
            const gVal = data[idx + 1];
            const bVal = data[idx + 2];
            const luminance = 0.299 * rVal + 0.587 * gVal + 0.114 * bVal;

            // Invert: white background (255) -> darkness = 0; dark drawing -> darkness > 0
            darkness = Math.max(0, (250 - luminance) / 250);

            if (isGlitchEdge) {
              darkness *= 1.25;
            }
          } else {
            // Procedural fallback if image failed or still loading:
            // Two clearly distinct human hand silhouettes reaching from left and right edges
            const normX = dotX / width;
            const normY = dotY / height;
            const normCenterY = centerY / height;

            // Left hand reaching from left towards center
            const dLeftX = normX - 0.28;
            const dLeftY = normY - normCenterY;
            const distLeft = Math.sqrt(dLeftX * dLeftX * 1.8 + dLeftY * dLeftY * 6.0);

            // Right hand reaching from right towards center
            const dRightX = normX - 0.72;
            const dRightY = normY - normCenterY;
            const distRight = Math.sqrt(dRightX * dRightX * 1.8 + dRightY * dRightY * 6.0);

            if (distLeft < 0.24) {
              darkness = Math.max(0, 1 - distLeft / 0.24);
            } else if (distRight < 0.24) {
              darkness = Math.max(0, 1 - distRight / 0.24);
            }
          }

          // If background pixel (near white), omit dot for crisp canvas negative space
          if (darkness < 0.07) {
            continue;
          }

          // Subtle organic shimmer per dot
          const shimmer = prefersReducedMotion
            ? 1.0
            : 1.0 + Math.sin(elapsed * 0.003 + r * 0.4 + c * 0.25) * 0.04;

          // Render dot at its natural size without artificial center suppression
          const dotRadius =
            maxDotRadius * Math.pow(darkness, 0.92) * shimmer;

          if (dotRadius > 0.45) {
            ctx.moveTo(dotX + dotRadius, dotY);
            ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
          }
        }
      }

      // Single batched draw call for high-performance 60FPS rendering
      ctx.fill();

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    // Kick off animation loop
    animationFrameId = requestAnimationFrame(render);

    return () => {
      isDestroyed = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none select-none z-0"
      aria-hidden="true"
    />
  );
};
