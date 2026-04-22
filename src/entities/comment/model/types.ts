// Comment entity types
// Business entity representing a user comment

export interface Comment {
  _id: string
  _creationTime: number
  author: string
  content: string
}

export type CommentId = string
