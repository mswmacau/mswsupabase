import { CardSkeleton, ListSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw space-y-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card-dark h-32 animate-pulse rounded-xl" />
          ))}
        </div>
        <ListSkeleton count={5} />
      </div>
    </section>
  );
}
