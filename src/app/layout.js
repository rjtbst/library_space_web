// app/layout.js
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Toaster } from "sonner"; // ← add this
import Chatbot from "@/components/Chatbot";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Aartechus - Your Pathway to a Tech Career",
  description: "Not Just Coding — Learn How to Build AI-Powered Applications",
 
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={GeistSans.variable}>
       
      <body>
        <Navbar />
        {children}
        <Chatbot />
        <Footer />
        <Toaster   // ← add this
          position="top-right"
          richColors
          expand
          toastOptions={{
            duration: 5000,
            classNames: {
              toast: "font-sans",
            },
          }}
        />
      </body>
    </html>
  );
}