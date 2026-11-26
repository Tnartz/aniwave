import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const projectId = "aniwave-firestore-rules-tests";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "userProfiles/user-a"), {
      userId: "user-a",
      nickname: "Old profile",
      avatar: "🌙",
      publicFavorites: false,
      publicReviews: false,
      publicWatched: false,
      updatedAt: 1700000000000,
    });
    await setDoc(doc(db, "watchlists/old-entry"), {
      userId: "user-a",
      animeTitle: "Old anime",
      status: "completed",
    });
    await setDoc(doc(db, "animeReviews/old-review"), {
      userId: "user-a",
      animeTitle: "Old anime",
      rating: 8,
      text: "Old review",
      updatedAt: 1700000000000,
    });
    await setDoc(doc(db, "watchProgress/old-progress"), {
      userId: "user-a",
      animeTitle: "Old anime",
      season: 1,
      episode: 2,
      time: 120,
      duration: 1440,
      updatedAt: 1700000000000,
    });
    await setDoc(doc(db, "directMessages/message-a"), {
      fromId: "user-a",
      toId: "user-b",
      fromName: "A",
      fromAvatar: "🌙",
      toName: "B",
      toAvatar: "⭐",
      text: "Hello",
      createdAt: 1700000000000,
    });
  });
});

after(async () => {
  await env.cleanup();
});

test("legacy profile with publicReviews can still be updated by its owner", async () => {
  const db = env.authenticatedContext("user-a").firestore();
  await assertSucceeds(updateDoc(doc(db, "userProfiles/user-a"), {
    nickname: "Updated name",
    publicReviews: false,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  }));
  await assertFails(updateDoc(
    doc(env.authenticatedContext("user-b").firestore(), "userProfiles/user-a"),
    { nickname: "Not the owner" },
  ));
});

test("legacy watchlist without optional timestamps remains readable and updatable", async () => {
  const db = env.authenticatedContext("user-a").firestore();
  const ref = doc(db, "watchlists/old-entry");
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(updateDoc(ref, {
    status: "paused",
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  }));
  await assertFails(updateDoc(
    doc(env.authenticatedContext("user-b").firestore(), "watchlists/old-entry"),
    { status: "dropped" },
  ));
});

test("legacy review without optional displayName and server timestamp remains public and editable by its author", async () => {
  const ownerDb = env.authenticatedContext("user-a").firestore();
  const guestDb = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(guestDb, "animeReviews/old-review")));
  await assertSucceeds(updateDoc(doc(ownerDb, "animeReviews/old-review"), {
    text: "Updated legacy review",
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  }));
  await assertFails(updateDoc(
    doc(env.authenticatedContext("user-b").firestore(), "animeReviews/old-review"),
    { text: "Hijacked review" },
  ));
});

test("legacy watch progress without optional server timestamp remains usable by its owner only", async () => {
  const ownerDb = env.authenticatedContext("user-a").firestore();
  await assertSucceeds(getDoc(doc(ownerDb, "watchProgress/old-progress")));
  await assertSucceeds(updateDoc(doc(ownerDb, "watchProgress/old-progress"), {
    time: 180,
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  }));
  await assertFails(getDoc(
    doc(env.authenticatedContext("user-b").firestore(), "watchProgress/old-progress"),
  ));
});

test("public favorites and watchlists queries work only when the profile visibility flags are enabled", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "userProfiles/user-public"), {
      userId: "user-public",
      nickname: "Public user",
      avatar: "🌙",
      publicFavorites: true,
      publicWatched: true,
    });
    await setDoc(doc(db, "favorites/public-favorite"), {
      userId: "user-public",
      animeTitle: "Public anime",
      createdAt: new Date(),
    });
    await setDoc(doc(db, "watchlists/public-watchlist"), {
      userId: "user-public",
      animeTitle: "Public anime",
      status: "completed",
    });
  });

  const guestDb = env.unauthenticatedContext().firestore();
  const publicFavoritesQuery = query(
    collection(guestDb, "favorites"),
    where("userId", "==", "user-public"),
  );
  const publicWatchlistsQuery = query(
    collection(guestDb, "watchlists"),
    where("userId", "==", "user-public"),
  );
  await assertSucceeds(getDocs(publicFavoritesQuery));
  await assertSucceeds(getDocs(publicWatchlistsQuery));

  const privateFavoritesQuery = query(
    collection(guestDb, "favorites"),
    where("userId", "==", "user-a"),
  );
  const privateWatchlistsQuery = query(
    collection(guestDb, "watchlists"),
    where("userId", "==", "user-a"),
  );
  await assertFails(getDocs(privateFavoritesQuery));
  await assertFails(getDocs(privateWatchlistsQuery));
});

test("direct messages can be queried by sender or recipient, but not by outsiders", async () => {
  const senderDb = env.authenticatedContext("user-a").firestore();
  const recipientDb = env.authenticatedContext("user-b").firestore();
  const outsiderDb = env.authenticatedContext("user-c").firestore();

  await assertSucceeds(getDocs(query(
    collection(senderDb, "directMessages"),
    where("fromId", "==", "user-a"),
  )));
  await assertSucceeds(getDocs(query(
    collection(recipientDb, "directMessages"),
    where("toId", "==", "user-b"),
  )));
  await assertFails(getDocs(collection(outsiderDb, "directMessages")));

  await assertSucceeds(setDoc(doc(senderDb, "directMessages/message-from-a"), {
    fromId: "user-a",
    toId: "user-b",
    fromName: "A",
    fromAvatar: "🌙",
    toName: "B",
    toAvatar: "⭐",
    text: "A valid message",
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(senderDb, "directMessages/message-spoofed"), {
    fromId: "user-b",
    toId: "user-a",
    fromName: "B",
    fromAvatar: "⭐",
    toName: "A",
    toAvatar: "🌙",
    text: "Spoofed sender",
    createdAt: Date.now(),
  }));
});

test("only users with the admin custom claim can write anime catalog and streams", async () => {
  const regularDb = env.authenticatedContext("user-a").firestore();
  const adminDb = env.authenticatedContext("admin-user", { admin: true }).firestore();

  await assertFails(setDoc(doc(regularDb, "animeCatalog/regular-write"), {
    name: "Unauthorized anime",
  }));
  await assertFails(setDoc(doc(regularDb, "streams/regular-write"), {
    animeTitle: "Unauthorized anime",
  }));

  await assertSucceeds(setDoc(doc(adminDb, "animeCatalog/admin-write"), {
    name: "Authorized anime",
  }));
  await assertSucceeds(setDoc(doc(adminDb, "streams/admin-write"), {
    animeTitle: "Authorized anime",
  }));
});


test("user profiles are publicly readable but writable only by the matching owner", async () => {
  const guestDb = env.unauthenticatedContext().firestore();
  const ownerDb = env.authenticatedContext("user-a").firestore();
  const outsiderDb = env.authenticatedContext("user-b").firestore();

  await assertSucceeds(getDoc(doc(guestDb, "userProfiles/user-a")));

  await assertSucceeds(updateDoc(doc(ownerDb, "userProfiles/user-a"), {
    nickname: "Owner updated",
    avatar: "🌙",
    updatedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
  }));

  await assertFails(updateDoc(doc(outsiderDb, "userProfiles/user-a"), {
    nickname: "Outsider update",
  }));

  await assertFails(updateDoc(doc(ownerDb, "userProfiles/user-a"), {
    userId: "user-b",
  }));

  await assertFails(deleteDoc(doc(outsiderDb, "userProfiles/user-a")));
  await assertSucceeds(deleteDoc(doc(ownerDb, "userProfiles/user-a")));
});

test("anime comments can be created by their author, cannot be updated, and can only be deleted by their author", async () => {
  const ownerDb = env.authenticatedContext("user-a").firestore();
  const outsiderDb = env.authenticatedContext("user-b").firestore();
  const commentRef = doc(ownerDb, "animeComments/comment-a");

  await assertSucceeds(setDoc(commentRef, {
    userId: "user-a",
    animeTitle: "Test anime",
    season: 1,
    episode: 1,
    nickname: "User A",
    avatar: "🌙",
    text: "A valid comment",
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  }));

  await assertFails(updateDoc(commentRef, { text: "Edited comment" }));
  await assertFails(deleteDoc(doc(outsiderDb, "animeComments/comment-a")));
  await assertSucceeds(deleteDoc(commentRef));
});

test("favorites support owner CRUD and reject writes by other users", async () => {
  const ownerDb = env.authenticatedContext("user-a").firestore();
  const outsiderDb = env.authenticatedContext("user-b").firestore();
  const favoriteRef = doc(ownerDb, "favorites/favorite-a");

  await assertSucceeds(setDoc(favoriteRef, {
    userId: "user-a",
    animeTitle: "Test anime",
    createdAt: new Date(),
  }));

  await assertSucceeds(updateDoc(favoriteRef, {
    animeTitle: "Updated anime",
    createdAt: new Date(),
  }));

  await assertFails(updateDoc(
    doc(outsiderDb, "favorites/favorite-a"),
    { animeTitle: "Hijacked favorite" },
  ));
  await assertFails(deleteDoc(doc(outsiderDb, "favorites/favorite-a")));
  await assertSucceeds(deleteDoc(favoriteRef));
});

test("favorites reject invalid document fields and timestamp types", async () => {
  const ownerDb = env.authenticatedContext("user-a").firestore();

  await assertFails(setDoc(doc(ownerDb, "favorites/invalid-title"), {
    userId: "user-a",
    animeTitle: "x".repeat(201),
    createdAt: new Date(),
  }));

  await assertFails(setDoc(doc(ownerDb, "favorites/invalid-timestamp"), {
    userId: "user-a",
    animeTitle: "Test anime",
    createdAt: Date.now(),
  }));
});

test("watch progress rejects invalid types and out-of-range episode metadata", async () => {
  const ownerDb = env.authenticatedContext("user-a").firestore();

  const baseProgress = {
    userId: "user-a",
    animeTitle: "Test anime",
    season: 1,
    episode: 1,
    time: 0,
    duration: 1200,
    updatedAt: Date.now(),
  };

  await assertFails(setDoc(doc(ownerDb, "watchProgress/string-season"), {
    ...baseProgress,
    season: "1",
  }));

  await assertFails(setDoc(doc(ownerDb, "watchProgress/season-too-high"), {
    ...baseProgress,
    season: 100,
  }));

  await assertFails(setDoc(doc(ownerDb, "watchProgress/negative-time"), {
    ...baseProgress,
    time: -1,
  }));
});

test("watchlists reject invalid status values and optional timestamp types", async () => {
  const ownerDb = env.authenticatedContext("user-a").firestore();

  await assertFails(setDoc(doc(ownerDb, "watchlists/invalid-status"), {
    userId: "user-a",
    animeTitle: "Test anime",
    status: "watching-now",
  }));

  await assertFails(setDoc(doc(ownerDb, "watchlists/invalid-updated-at"), {
    userId: "user-a",
    animeTitle: "Test anime",
    status: "watching",
    updatedAt: "not-an-integer",
  }));
});

test("anime reviews reject ratings outside the allowed range and oversized text", async () => {
  const ownerDb = env.authenticatedContext("user-a").firestore();

  await assertFails(setDoc(doc(ownerDb, "animeReviews/rating-too-high"), {
    userId: "user-a",
    animeTitle: "Test anime",
    rating: 11,
    text: "Valid review",
  }));

  await assertFails(setDoc(doc(ownerDb, "animeReviews/text-too-long"), {
    userId: "user-a",
    animeTitle: "Test anime",
    rating: 8,
    text: "x".repeat(1201),
  }));
});

test("direct messages cannot be updated or deleted by sender or recipient", async () => {
  const senderDb = env.authenticatedContext("user-a").firestore();
  const recipientDb = env.authenticatedContext("user-b").firestore();

  await assertFails(updateDoc(
    doc(senderDb, "directMessages/message-a"),
    { text: "Edited message" },
  ));
  await assertFails(deleteDoc(doc(senderDb, "directMessages/message-a")));
  await assertFails(deleteDoc(doc(recipientDb, "directMessages/message-a")));
});

