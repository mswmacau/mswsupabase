import { GridSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw">
        <div className="max-w-2xl">
          <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
          <div className="mt-4 h-10 w-56 animate-pulse rounded bg-white/10" />
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-dark h-32 animate-pulse rounded-xl" />
          ))}
        </div>
        <GridSkeleton count={6} />
      </div>
    </section>
  );
}
