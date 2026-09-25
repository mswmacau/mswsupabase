import { HeroSkeleton, SectionSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <HeroSkeleton />
      <SectionSkeleton cards={3} />
    </>
  );
}
