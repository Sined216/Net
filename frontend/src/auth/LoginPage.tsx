import { useEffect, useState } from 'react';
import { Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, currentBaseUrl } from './AuthContext';

export function LoginPage() {
  const { user, signIn, loginError } = useAuth();
  const navigate = useNavigate();
  const [baseUrl, setBaseUrlField] = useState(currentBaseUrl());
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('change-me-please');
  const [submitting, setSubmitting] = useState(false);

  // signIn() только обновляет состояние пользователя в контексте — сам на
  // /devices не перекидывает, поэтому редирект после успешного входа делаем
  // здесь: как только user появился, уходим с /login.
  useEffect(() => {
    if (user) navigate('/devices', { replace: true });
  }, [user, navigate]);

  // если на /login попали уже залогиненными (например, вручную вбили URL) —
  // сразу редирект, без лишнего кадра с формой входа
  if (user) return <Navigate to="/devices" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(baseUrl, username, password);
    } catch {
      // ошибка уже отображается через loginError
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Center mih="100vh">
      <Paper component="form" onSubmit={handleSubmit} withBorder shadow="md" p="xl" radius="md" w={340}>
        <Title order={2}>WireMap</Title>
        <Text c="dimmed" size="sm" mb="md">
          Документация сетевой инфраструктуры
        </Text>
        <Stack gap="sm">
          <TextInput label="Адрес API" value={baseUrl} onChange={(e) => setBaseUrlField(e.currentTarget.value)} />
          <TextInput label="Логин" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
          <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
          <Button type="submit" loading={submitting} fullWidth mt="sm">
            Войти
          </Button>
          {loginError && (
            <Text c="red" size="sm">
              {loginError}
            </Text>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
