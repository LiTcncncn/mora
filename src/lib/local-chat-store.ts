"use client";

import type { Conversation, ConversationMessage } from "@/domain/conversation";
import type { MemoryItem } from "@/domain/memory";

type LocalBundle = {
  conversation: Conversation;
  memories: MemoryItem[];
  lastConfigHash: string | null;
};

function storageKey(userId: string): string {
  return `zhaka:v1:local-chat:${userId}`;
}

function emptyConversation(userId: string): Conversation {
  const now = new Date().toISOString();
  return {
    id: `local-conv-${userId}`,
    profileId: "profile-default",
    title: "本地对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function loadLocalChat(userId: string): LocalBundle {
  if (typeof window === "undefined") {
    return {
      conversation: emptyConversation(userId),
      memories: [],
      lastConfigHash: null,
    };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) {
      return {
        conversation: emptyConversation(userId),
        memories: [],
        lastConfigHash: null,
      };
    }
    const parsed = JSON.parse(raw) as LocalBundle;
    if (!parsed.conversation?.id) {
      return {
        conversation: emptyConversation(userId),
        memories: [],
        lastConfigHash: null,
      };
    }
    return {
      conversation: parsed.conversation,
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      lastConfigHash: parsed.lastConfigHash ?? null,
    };
  } catch {
    return {
      conversation: emptyConversation(userId),
      memories: [],
      lastConfigHash: null,
    };
  }
}

export function saveLocalChat(userId: string, bundle: LocalBundle): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(bundle));
}

export function appendLocalMessages(
  userId: string,
  messages: ConversationMessage[],
  extra?: { memories?: MemoryItem[]; lastConfigHash?: string | null },
): LocalBundle {
  const current = loadLocalChat(userId);
  const next: LocalBundle = {
    conversation: {
      ...current.conversation,
      updatedAt: new Date().toISOString(),
      messages: [...current.conversation.messages, ...messages],
    },
    memories: extra?.memories ?? current.memories,
    lastConfigHash:
      extra?.lastConfigHash !== undefined
        ? extra.lastConfigHash
        : current.lastConfigHash,
  };
  saveLocalChat(userId, next);
  return next;
}

export function replaceLocalMemories(
  userId: string,
  memories: MemoryItem[],
): LocalBundle {
  const current = loadLocalChat(userId);
  const next = { ...current, memories };
  saveLocalChat(userId, next);
  return next;
}
