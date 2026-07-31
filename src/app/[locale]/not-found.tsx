import { Link } from '@/i18n/navigation';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">404</h1>
      <p className="mt-4 text-gray-500">This page could not be found.</p>
      <Link href="/" className="mt-8 inline-block text-brand-600 hover:underline">
        ← Home
      </Link>
    </div>
  );
}
