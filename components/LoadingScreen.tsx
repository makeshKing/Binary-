'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface LoadingScreenProps {
  variant?: 'fullscreen' | 'chart' | 'panel';
  label?: string;
  sublabel?: string;
  symbol?: string;
}

const CANDLES = [
  {
    id: 1,
    color: '#32e6b7',
    wickTop: 7,
    bodyHeight: 28,
    wickBottom: 9,
    baseY: 8,
    deltaY: -10,
    delay: 0.0,
  },
  {
    id: 2,
    color: '#5665f3',
    wickTop: 7,
    bodyHeight: 34,
    wickBottom: 11,
    baseY: -10,
    deltaY: 9,
    delay: 0.12,
  },
  {
    id: 3,
    color: '#32e6b7',
    wickTop: 6,
    bodyHeight: 30,
    wickBottom: 9,
    baseY: -7,
    deltaY: 11,
    delay: 0.24,
  },
  {
    id: 4,
    color: '#5665f3',
    wickTop: 7,
    bodyHeight: 20,
    wickBottom: 14,
    baseY: 3,
    deltaY: -9,
    delay: 0.36,
  },
  {
    id: 5,
    color: '#32e6b7',
    wickTop: 8,
    bodyHeight: 22,
    wickBottom: 8,
    baseY: 11,
    deltaY: -11,
    delay: 0.48,
  },
  {
    id: 6,
    color: '#5665f3',
    wickTop: 8,
    bodyHeight: 21,
    wickBottom: 9,
    baseY: 5,
    deltaY: -8,
    delay: 0.6,
  },
  {
    id: 7,
    color: '#32e6b7',
    wickTop: 7,
    bodyHeight: 34,
    wickBottom: 7,
    baseY: -3,
    deltaY: 10,
    delay: 0.72,
  },
  {
    id: 8,
    color: '#5665f3',
    wickTop: 8,
    bodyHeight: 24,
    wickBottom: 8,
    baseY: 9,
    deltaY: -10,
    delay: 0.84,
  },
];

function CandlestickGraphic() {
  return (
    <div className="flex flex-col items-center justify-center select-none">
      {/* Animated Candlesticks */}
      <div className="flex h-24 items-center justify-center gap-[5px]">
        {CANDLES.map((candle) => (
          <motion.div
            key={candle.id}
            initial={{ y: candle.baseY, scaleY: 1 }}
            animate={{
              y: [
                candle.baseY,
                candle.baseY + candle.deltaY,
                candle.baseY - candle.deltaY * 0.45,
                candle.baseY,
              ],
              scaleY: [1, 1.12, 0.9, 1],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: candle.delay,
              ease: 'easeInOut',
            }}
            className="flex flex-col items-center"
          >
            {/* Upper Wick */}
            <div
              className="w-[2px] rounded-full"
              style={{
                height: `${candle.wickTop}px`,
                backgroundColor: candle.color,
              }}
            />
            {/* Candle Body */}
            <div
              className="w-[7px] rounded-[1.5px]"
              style={{
                height: `${candle.bodyHeight}px`,
                backgroundColor: candle.color,
              }}
            />
            {/* Lower Wick */}
            <div
              className="w-[2px] rounded-full"
              style={{
                height: `${candle.wickBottom}px`,
                backgroundColor: candle.color,
              }}
            />
          </motion.div>
        ))}
      </div>

      {/* Tagline */}
      <p className="mt-6 text-[14px] font-medium tracking-[0.01em] text-[#f3f4f6]">
        Trading Smarter, Earning Better
      </p>
    </div>
  );
}

export default function LoadingScreen({
  variant = 'fullscreen',
}: LoadingScreenProps) {
  if (variant === 'chart') {
    return (
      <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#24262b] select-none px-4">
        <CandlestickGraphic />
      </div>
    );
  }

  if (variant === 'panel') {
    return (
      <div className="relative flex min-h-[420px] w-full flex-col items-center justify-center rounded-2xl bg-[#24262b] text-white select-none overflow-hidden px-4 py-12">
        <CandlestickGraphic />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#24262b] text-white select-none overflow-hidden px-4">
      <CandlestickGraphic />
    </div>
  );
}

/**
 * Initial App Boot Splash Gate:
 * Displays the minimalist candlestick animation briefly on initial application boot,
 * then fades out seamlessly to reveal the workspace.
 */
export function AppBootGate({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setBooting(false);
    }, 850);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <AnimatePresence>
        {booting && (
          <motion.div
            key="app-boot-splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="fixed inset-0 z-[100]"
          >
            <LoadingScreen variant="fullscreen" />
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </>
  );
}
