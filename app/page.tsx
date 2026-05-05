'use client'

import React from "react"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Sun, Zap, Users, TrendingUp } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { authMode, login, isLoading, user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (user) {
      router.replace('/dashboard')
    }
  }, [router, user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email) {
      toast.error('Por favor ingresa tu email')
      return
    }

    const result = await login(email, password)
    
    if (result.success) {
      toast.success('Bienvenido a NoonApp')
      if (authMode === 'supabase') {
        window.location.replace('/dashboard')
        return
      }

      router.push('/dashboard')
    } else {
      toast.error(
        result.reason === 'network_error'
          ? 'No se pudo conectar con Supabase. Revisa tu red o DNS.'
          : authMode === 'supabase'
            ? 'Credenciales invalidas.'
            : 'Credenciales invalidas. Usa uno de los emails de prueba.'
      )
    }
  }

  const demoAccounts = [
    { email: 'admin@noon.app', role: 'Admin', description: 'Acceso total' },
    { email: 'juan@noon.app', role: 'Vendedor', description: 'Pipeline de ventas' },
    { email: 'ana@noon.app', role: 'PM', description: 'Gestion de proyectos' },
    { email: 'pedro@noon.app', role: 'Developer', description: 'Tareas asignadas' },
  ]

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar text-sidebar-foreground px-12 py-10 flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="size-10 rounded-lg bg-primary flex items-center justify-center">
              <Sun className="size-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold">NoonApp</span>
          </div>
          
          <h1 className="text-[32px] font-semibold leading-tight mb-5 text-balance">
            Gestiona ventas y proyectos en un solo lugar
          </h1>
          <p className="text-sidebar-foreground/70 text-sm leading-6 mb-10 max-w-xl">
            Plataforma integral para equipos de ventas y desarrollo. Desde el primer contacto hasta la entrega final.
          </p>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="size-10 rounded-lg bg-sidebar-accent flex items-center justify-center shrink-0">
                <Zap className="size-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Ventas asistidas por IA</h3>
                <p className="text-sm text-sidebar-foreground/60">Scoring de leads, propuestas automaticas y seguimiento inteligente</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="size-10 rounded-lg bg-sidebar-accent flex items-center justify-center shrink-0">
                <Users className="size-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Hand-off perfecto</h3>
                <p className="text-sm text-sidebar-foreground/60">Transicion fluida de ventas a delivery sin perder contexto</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="size-10 rounded-lg bg-sidebar-accent flex items-center justify-center shrink-0">
                <TrendingUp className="size-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Comisiones y recompensas</h3>
                <p className="text-sm text-sidebar-foreground/60">Sistema de puntos y pagos automatizados para todo el equipo</p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-sidebar-foreground/50">
          NoonApp MVP Demo
        </p>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="size-10 rounded-lg bg-primary flex items-center justify-center">
              <Sun className="size-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold">NoonApp</span>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-[28px] font-semibold leading-[1.15]">Iniciar sesion</CardTitle>
              <CardDescription>
                Ingresa tus credenciales para acceder al sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="tu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="********"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Spinner className="mr-2" />
                      Ingresando...
                    </>
                  ) : (
                    'Ingresar'
                  )}
                </Button>
              </form>

              {authMode === 'mock' && (
                <div className="mt-6">
                  <p className="text-sm text-muted-foreground mb-3">Cuentas de prueba:</p>
                  <div className="space-y-2">
                    {demoAccounts.map((account) => (
                      <button
                        key={account.email}
                        type="button"
                        onClick={() => setEmail(account.email)}
                        className="w-full rounded-md px-3 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{account.email}</p>
                            <p className="text-xs text-muted-foreground">{account.description}</p>
                          </div>
                          <span className="text-xs bg-secondary px-2 py-1 rounded-md font-medium">
                            {account.role}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
