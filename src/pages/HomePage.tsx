/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DotMatrixBackground } from '../components/DotMatrixBackground';
import { HeroSection } from '../components/HeroSection';
import { PartnerStrip } from '../components/PartnerStrip';
import { HowItWorksModal } from '../components/HowItWorksModal';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);

  return (
    <div className="relative min-h-screen flex flex-col justify-between select-text">
      {/* Exact large-scale two-hand dot-matrix background animation preserved */}
      <DotMatrixBackground />

      {/* Hero section */}
      <div className="relative z-10 w-full flex-1 flex flex-col justify-center">
        <HeroSection
          onExplore={() => navigate('/convert')}
          onSeeHowItWorks={() => setIsHowItWorksOpen(true)}
        />
      </div>

      {/* Bottom partner strip */}
      <PartnerStrip />

      {/* Explanatory modal for 'See how it works' */}
      <HowItWorksModal
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
        onExplore={() => {
          setIsHowItWorksOpen(false);
          navigate('/convert');
        }}
      />
    </div>
  );
};
