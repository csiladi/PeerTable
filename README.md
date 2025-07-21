# PeerTable: Real-Time Collaborative Tables

**PeerTable** is a modern web application for creating and collaborating on tables in real time. Designed for teams, classrooms, and individuals, PeerTable lets multiple users edit the same table simultaneously, with seamless offline support and a beautiful, responsive UI.

> 🚀 **Live Demo:** [https://peer-table.lovable.app/](https://peer-table.lovable.app/)

---

## 🌟 Highlights

- Effortless real-time collaboration—see edits from teammates instantly.
- Seamless offline mode—keep working even without internet, syncs when back online.
- User presence—see who is active and where they are editing in the table.
- Intuitive table management—create, rename, and delete tables with ease.
- Secure authentication—sign up and sign in with email/password.
- Beautiful, responsive UI with light/dark mode.
- Change history—track and review all edits.

### Mock Screenshots

| Sign In / Sign Up | Table List | Real-Time Collaboration |
|------------------|------------|------------------------|
| ![Sign In Screenshot](/mock-signin.png) | ![Table List Screenshot](/mock-tablelist.png) | ![Collaboration Screenshot](/mock-collab.png) |

| Offline Mode | Change History |
|--------------|----------------|
| ![Offline Mode Screenshot](/mock-offline.png) | ![History Screenshot](/mock-history.png) |

---

## ✨ Features

- **Real-Time Collaboration:** Multiple users can edit tables together, with instant updates powered by Supabase.
- **Authentication:** Secure sign up and sign in with email and password.
- **Table Management:** Create, select, and delete tables. Each table is private to its creator and collaborators.
- **Cell Editing:** Click any cell to edit. Changes are synced live to all users.
- **Offline Support:** Work offline—changes are saved locally and synced when you reconnect.
- **User Presence:** See who else is active in your table and where they are editing.
- **Change History:** Track and review edits made to each table.
- **Dark Mode:** Toggle between light and dark themes for comfortable viewing.
- **Responsive Design:** Works beautifully on desktop and mobile devices.

---

## 🛠️ Tech Stack

- **React** + **TypeScript**
- **Vite** (blazing fast dev/build)
- **Supabase** (auth, database, real-time sync)
- **shadcn/ui** (UI components)
- **Tailwind CSS** (utility-first styling)
- **@tanstack/react-query** (data fetching/caching)

---

## 🚀 Getting Started

### 1. **Clone the Repository**

```sh
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
```

### 2. **Install Dependencies**

```sh
npm install
```

### 3. **Run the Development Server**

```sh
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173) (or as shown in your terminal).

---

## 🔐 Authentication & Environment

- **Authentication** is handled via Supabase. Users sign up/sign in with email and password.
- The project is pre-configured with a public Supabase instance (see `src/integrations/supabase/client.ts`).
- **No additional environment variables are required** for local development. If you wish to use your own Supabase project, update the `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `src/integrations/supabase/client.ts`.

---

## 📦 Build & Deploy

To build for production:

```sh
npm run build
```

To preview the production build locally:

```sh
npm run preview
```

---

## 📝 Usage

1. **Sign Up / Sign In:** Create an account with your email and password.
2. **Create a Table:** Name your table and start collaborating.
3. **Invite Others:** Share your app URL—anyone who signs in can join and collaborate in real time.
4. **Edit Cells:** Click any cell to edit. Changes sync instantly.
5. **Go Offline:** You can continue working offline; your changes will sync when you reconnect.

---

## ⚙️ Customization & Configuration

- **UI & Theme:** Easily switch between light and dark mode using the toggle in the top-right corner.
- **Tailwind CSS:** Customize styles in `tailwind.config.ts` and `src/index.css`.
- **Supabase:** To use your own backend, update the Supabase credentials in `src/integrations/supabase/client.ts`.

---

## 🤝 Contributing

Contributions are welcome! Please open issues or pull requests for improvements, bug fixes, or new features.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
