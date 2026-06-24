import { SlideEngineDocumentFixture } from "@/components/SlideEngineDocumentFixture";
import { allBlockTypesSlideDocument } from "@learnordie/slide-engine/fixtures";

export default async function SlideEngineBlocksQaPage({
  searchParams
}: {
  searchParams?: Promise<{ slide?: string }>;
}) {
  const params = await searchParams;
  return (
    <SlideEngineDocumentFixture
      document={allBlockTypesSlideDocument}
      initialSlideId={params?.slide}
    />
  );
}
