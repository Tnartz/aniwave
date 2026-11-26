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
