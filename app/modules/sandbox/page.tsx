'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { recordAnalyticsVisit } from '@/src/utils/analytics';

export default function SandboxModule() {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-400">
          <ChevronLeft size={16} />
          All modules
        </Link>

        <h1 className="text-3xl font-medium text-gray-900 mt-6">
          Sandbox
        </h1>
      </div>
    </main>
  );
}