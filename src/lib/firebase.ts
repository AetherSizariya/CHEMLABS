import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc, onSnapshot, doc, setDoc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "silent-index-d7c1c",
  appId: "1:1085896505941:web:319843a50652bfdb9372dc",
  apiKey: "AIzaSyB4FLzXFGTe4aJ1C8eVZykdM_8BgIY4N00",
  authDomain: "silent-index-d7c1c.firebaseapp.com",
  storageBucket: "silent-index-d7c1c.firebasestorage.app",
  messagingSenderId: "1085896505941"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, 'ai-studio-b9765c0c-5760-4f17-904b-fa859cb33965');
