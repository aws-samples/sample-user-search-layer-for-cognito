import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppLayout, SideNavigation, TopNavigation } from '@cloudscape-design/components';
import type { SideNavigationProps } from '@cloudscape-design/components';
import '@cloudscape-design/global-styles/index.css';

interface LayoutProps {
  children: ReactNode;
  user: { username: string } | undefined;
  signOut: (() => void) | undefined;
}

const NAV_ITEMS: SideNavigationProps.Item[] = [
  { type: 'link', text: 'Single-property user search', href: '/single-property-user-search' },
  { type: 'link', text: 'Multi-property user search', href: '/multi-property-user-search' },
  { type: 'link', text: 'Autosuggest user search', href: '/autosuggest-user-search' },
];

function Layout({ children, user, signOut }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigation = (event: CustomEvent<SideNavigationProps.FollowDetail>) => {
    event.preventDefault();
    navigate(event.detail.href);
  };

  return (
    <>
      <TopNavigation
        identity={{
          logo: { src: '/amazon-cognito-icon.svg' },
          href: '/',
          title: 'Advanced Search Capabilities for Amazon Cognito Users',
        }}
        utilities={[
          {
            type: 'menu-dropdown',
            iconName: 'user-profile',
            ariaLabel: 'User profile',
            title: user?.username ?? '',
            items: [{ id: 'signout', text: 'Sign out' }],
            onItemClick: ({ detail }) => {
              if (detail.id === 'signout') signOut?.();
            },
          },
        ]}
      />
      <AppLayout
        navigation={
          <SideNavigation
            activeHref={location.pathname}
            header={{ text: 'Example Integrations', href: '/' }}
            items={NAV_ITEMS}
            onFollow={handleNavigation}
          />
        }
        content={children}
        toolsHide={true}
        contentType="default"
        navigationWidth={300}
      />
    </>
  );
}

export default Layout;
