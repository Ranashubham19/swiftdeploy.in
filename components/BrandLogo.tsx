import React from 'react';

interface BrandLogoProps {
  compact?: boolean;
  className?: string;
}

const BrandLogo: React.FC<BrandLogoProps> = ({ compact = false, className = '' }) => {
  return (
    <div className={`leading-none ${className}`}>
      <p className={`${compact ? 'text-[16px]' : 'text-[18px]'} font-semibold tracking-tight text-white`}>
        swiftdeploy<span className="text-zinc-400 italic">.in</span>
      </p>
    </div>
  );
};

export default BrandLogo;
