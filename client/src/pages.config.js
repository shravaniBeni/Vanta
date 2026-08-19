import Home from '@/pages/Home';
import Chat from '@/pages/Chat';
import Editor from '@/pages/Editor';
import Deploy from '@/pages/Deploy';
import Layout from '@/Layout';

export const pagesConfig = {
  Pages: {
    Home,
    Chat,
    Editor,
    Deploy,
  },
  Layout,
  mainPage: 'Home',
};
