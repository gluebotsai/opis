import { listDueSeoSocialPosts } from "@/dao/seo/seo-store";
import { publishSeoSocialPost } from "@/service/seo/social-publish";

export async function processDueSeoSocialPublishes(limit = 25): Promise<{
  scanned: number;
  published: number;
  failed: number;
}> {
  const due = await listDueSeoSocialPosts(limit);
  let published = 0;
  let failed = 0;
  for (const post of due) {
    const result = await publishSeoSocialPost({
      organizationId: post.organizationId,
      postId: post.id,
    });
    if (result.ok) published += 1;
    else failed += 1;
  }
  return { scanned: due.length, published, failed };
}
