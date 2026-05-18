import { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Button, Container, Header, SpaceBetween } from '@cloudscape-design/components';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Container>
          <SpaceBetween size="l">
            <Header variant="h1">Something went wrong</Header>
            <Box variant="p">
              An unexpected error occurred. Please try again.
            </Box>
            <Box variant="code">{this.state.error?.message}</Box>
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={this.handleReset}>Try again</Button>
              <Button variant="link" onClick={() => { window.location.href = '/'; }}>Go home</Button>
            </SpaceBetween>
          </SpaceBetween>
        </Container>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
