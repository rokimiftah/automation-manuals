import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import { CommentForm, CommentList } from "./ui"

export default function CommentsIsland() {
  return (
    <ConvexProviderWrapper>
      <div className="space-y-8">
        <CommentForm />
        <CommentList />
      </div>
    </ConvexProviderWrapper>
  )
}
