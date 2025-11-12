// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDXUJ2ooY5S_pR2liDGe-afRZhNo0RI8Zs",
  authDomain: "latinfroggame.firebaseapp.com",
  databaseURL: "https://latinfroggame-default-rtdb.firebaseio.com",
  projectId: "latinfroggame",
  storageBucket: "latinfroggame.firebasestorage.app",
  messagingSenderId: "196302891263",
  appId: "1:196302891263:web:0b2fd634738f890580c4ca",
  measurementId: "G-S5H91BQYMB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
