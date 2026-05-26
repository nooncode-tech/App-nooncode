/**
 * Niche catalog for Maxwell Lead Engine V1.
 *
 * Data-only module. No server-only imports, no env access, no side effects.
 * Safe to import from Client Components (per Architecture C6).
 *
 * Backend owns this file (per spec affected-files table). Frontend created
 * the initial version because the catalog blocks compilation of the niche
 * selector component. If Backend reaches a different shape during its own
 * implementation, this file is the merge point — keep the public surface
 * (types + helpers) stable per Architecture C1/C2.
 */

export type NicheOverpassTag = {
  key: string
  value: string
}

export type Niche = {
  id: string
  label: string
  familyId: string
  overpassTags: NicheOverpassTag[]
  auditHint: string
}

export type NicheFamily = {
  id: string
  label: string
}

export const NICHE_FAMILIES: NicheFamily[] = [
  { id: 'gastronomia', label: 'Restaurantes & Gastronomía' },
  { id: 'salud', label: 'Salud & Medicina' },
  { id: 'belleza', label: 'Belleza & Estética' },
  { id: 'fitness', label: 'Fitness & Bienestar' },
  { id: 'educacion', label: 'Educación & Formación' },
  { id: 'profesionales', label: 'Servicios Profesionales' },
  { id: 'retail', label: 'Retail & Comercio' },
  { id: 'automotriz', label: 'Automotriz' },
  { id: 'hospedaje', label: 'Hoteles & Hospedaje' },
  { id: 'turismo', label: 'Turismo & Experiencias' },
  { id: 'eventos', label: 'Eventos & Celebraciones' },
  { id: 'inmobiliaria', label: 'Inmobiliaria & Construcción' },
  { id: 'logistica', label: 'Logística & Transporte' },
  { id: 'mascotas', label: 'Mascotas & Veterinaria' },
  { id: 'hogar', label: 'Hogar & Servicios Domésticos' },
  { id: 'finanzas', label: 'Finanzas & Seguros' },
  { id: 'medios', label: 'Medios & Entretenimiento' },
  { id: 'comunidades', label: 'Organizaciones & Comunidades' },
  { id: 'manufactura', label: 'Industria & Manufactura' },
  { id: 'bienestar_alt', label: 'Salud & Bienestar Alternativo' },
]

export const NICHES: Niche[] = [
  // F1 — Restaurantes & Gastronomía
  { id: 'restaurante', label: 'Restaurante', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'restaurant' }], auditHint: 'Pain frecuente: sin reservas online, sin menú digital. Solución Noon: sistema de reservas + menú QR + tienda online.' },
  { id: 'cafeteria', label: 'Cafetería', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'cafe' }], auditHint: 'Pain frecuente: sin pedidos anticipados, sin fidelización digital. Solución Noon: app de pedidos + loyalty.' },
  { id: 'taqueria', label: 'Taquería / Antojería', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'fast_food' }], auditHint: 'Pain frecuente: solo pedidos presenciales, sin delivery propio. Solución Noon: landing + pedidos online.' },
  { id: 'pizzeria', label: 'Pizzería', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'restaurant' }], auditHint: 'Pain frecuente: dependencia de apps de delivery con comisiones altas. Solución Noon: delivery propio + pedidos online.' },
  { id: 'sushi', label: 'Sushi / Japonés', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'restaurant' }], auditHint: 'Pain frecuente: sin presencia premium online, sin reservas. Solución Noon: sitio editorial + reservas online.' },
  { id: 'marisqueria', label: 'Marisquería', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'restaurant' }], auditHint: 'Pain frecuente: sin presencia digital, clientes solo locales. Solución Noon: landing + reservas + Google Business.' },
  { id: 'panaderia', label: 'Panadería / Pastelería', familyId: 'gastronomia', overpassTags: [{ key: 'shop', value: 'bakery' }], auditHint: 'Pain frecuente: pedidos por WhatsApp manual, sin catálogo digital. Solución Noon: tienda online + pedidos anticipados.' },
  { id: 'heladeria', label: 'Heladería / Postres', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'ice_cream' }], auditHint: 'Pain frecuente: sin presencia digital, ventas solo presenciales. Solución Noon: landing + delivery.' },
  { id: 'food_truck', label: 'Food Truck', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'fast_food' }], auditHint: 'Pain frecuente: clientes no saben dónde están hoy. Solución Noon: landing con ubicación en tiempo real + redes.' },
  { id: 'bar', label: 'Bar / Cantina', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'bar' }], auditHint: 'Pain frecuente: sin agenda de eventos, sin reservas para grupos. Solución Noon: landing + eventos + reservas.' },
  { id: 'cocteleria', label: 'Coctelería / Speakeasy', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'bar' }], auditHint: 'Pain frecuente: sin presencia premium, difícil de encontrar. Solución Noon: sitio editorial + reservas exclusivas.' },
  { id: 'catering', label: 'Catering / Banquetes', familyId: 'gastronomia', overpassTags: [{ key: 'amenity', value: 'events_venue' }], auditHint: 'Pain frecuente: cotizaciones manuales, sin portafolio digital. Solución Noon: landing + formulario de cotización + galería.' },

  // F2 — Salud & Medicina
  { id: 'clinica_general', label: 'Clínica General', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'clinic' }], auditHint: 'Pain frecuente: agenda telefónica, fichas en papel. Solución Noon: sistema de citas online + expediente digital.' },
  { id: 'consultorio', label: 'Consultorio Médico', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'doctors' }], auditHint: 'Pain frecuente: sin citas online, sin recordatorios automáticos. Solución Noon: app de citas + recordatorios SMS/WhatsApp.' },
  { id: 'dental', label: 'Odontología / Dental', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'dentist' }], auditHint: 'Pain frecuente: alta deserción de pacientes, sin seguimiento. Solución Noon: CRM + citas + recordatorios de revisión.' },
  { id: 'psicologia', label: 'Psicología / Terapia', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'doctors' }], auditHint: 'Pain frecuente: sin agenda digital, sin sesión online. Solución Noon: landing + citas + videollamada integrada.' },
  { id: 'nutricion', label: 'Nutrición / Dietista', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'doctors' }], auditHint: 'Pain frecuente: sin seguimiento digital de pacientes. Solución Noon: app de seguimiento + citas + planes personalizados.' },
  { id: 'fisioterapia', label: 'Fisioterapia / Rehabilitación', familyId: 'salud', overpassTags: [{ key: 'healthcare', value: 'physiotherapist' }], auditHint: 'Pain frecuente: sin citas online, sin historial digital. Solución Noon: sistema de citas + progreso del paciente.' },
  { id: 'oftalmologia', label: 'Oftalmología / Óptica', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'optician' }], auditHint: 'Pain frecuente: sin catálogo de lentes online, sin citas. Solución Noon: tienda online + citas + catálogo visual.' },
  { id: 'dermatologia', label: 'Dermatología', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'doctors' }], auditHint: 'Pain frecuente: lista de espera larga, sin citas online. Solución Noon: sistema de citas + seguimiento de tratamientos.' },
  { id: 'ginecologia', label: 'Ginecología / Obstetricia', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'doctors' }], auditHint: 'Pain frecuente: sin citas online, pacientes no regresan. Solución Noon: portal de pacientes + citas + recordatorios.' },
  { id: 'pediatria', label: 'Pediatría', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'doctors' }], auditHint: 'Pain frecuente: sin historial digital accesible para padres. Solución Noon: portal de padres + citas + expediente.' },
  { id: 'cardiologia', label: 'Cardiología', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'doctors' }], auditHint: 'Pain frecuente: sin seguimiento remoto de pacientes. Solución Noon: portal de pacientes + citas + monitoreo.' },
  { id: 'laboratorio', label: 'Laboratorio Clínico', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'clinic' }], auditHint: 'Pain frecuente: resultados en papel, sin entrega digital. Solución Noon: portal de resultados + citas + notificaciones.' },
  { id: 'farmacia', label: 'Farmacia', familyId: 'salud', overpassTags: [{ key: 'amenity', value: 'pharmacy' }], auditHint: 'Pain frecuente: sin pedidos online, sin entregas a domicilio. Solución Noon: tienda online + delivery + surtido de recetas.' },

  // F3 — Belleza & Estética
  { id: 'salon_belleza', label: 'Salón de Belleza', familyId: 'belleza', overpassTags: [{ key: 'shop', value: 'hairdresser' }], auditHint: 'Pain frecuente: agenda por WhatsApp manual, sin reservas online. Solución Noon: sistema de citas + recordatorios + galería.' },
  { id: 'barberia', label: 'Barbería', familyId: 'belleza', overpassTags: [{ key: 'shop', value: 'hairdresser' }], auditHint: 'Pain frecuente: colas de espera, sin reservas digitales. Solución Noon: app de citas + fila virtual + fidelización.' },
  { id: 'nail_spa', label: 'Nail Spa / Uñas', familyId: 'belleza', overpassTags: [{ key: 'shop', value: 'beauty' }], auditHint: 'Pain frecuente: sin catálogo de diseños, reservas por DM. Solución Noon: catálogo visual + citas online.' },
  { id: 'spa_masajes', label: 'Spa / Masajes', familyId: 'belleza', overpassTags: [{ key: 'leisure', value: 'spa' }], auditHint: 'Pain frecuente: sin presencia premium, sin paquetes online. Solución Noon: sitio editorial + reservas + paquetes.' },
  { id: 'estetica', label: 'Estética / Cosmetología', familyId: 'belleza', overpassTags: [{ key: 'shop', value: 'beauty' }], auditHint: 'Pain frecuente: sin agenda digital, clientes solo de referido. Solución Noon: landing + citas + reseñas.' },
  { id: 'tatuajes', label: 'Micropigmentación / Tatuajes', familyId: 'belleza', overpassTags: [{ key: 'shop', value: 'tattoo' }], auditHint: 'Pain frecuente: sin portafolio digital, reservas por DM. Solución Noon: portafolio + citas + depósitos online.' },
  { id: 'depilacion', label: 'Depilación Láser', familyId: 'belleza', overpassTags: [{ key: 'shop', value: 'beauty' }], auditHint: 'Pain frecuente: sin seguimiento de sesiones, sin paquetes online. Solución Noon: portal de clientes + paquetes + citas.' },

  // F4 — Fitness & Bienestar
  { id: 'gimnasio', label: 'Gimnasio', familyId: 'fitness', overpassTags: [{ key: 'leisure', value: 'fitness_centre' }], auditHint: 'Pain frecuente: alta rotación de socios, sin app propia. Solución Noon: app de membresías + clases + check-in.' },
  { id: 'crossfit', label: 'CrossFit', familyId: 'fitness', overpassTags: [{ key: 'leisure', value: 'fitness_centre' }], auditHint: 'Pain frecuente: inscripciones manuales, sin seguimiento de WODs. Solución Noon: plataforma de membresías + resultados.' },
  { id: 'yoga_pilates', label: 'Yoga / Pilates', familyId: 'fitness', overpassTags: [{ key: 'sport', value: 'yoga' }], auditHint: 'Pain frecuente: clases llenas sin sistema de reservas. Solución Noon: reservas de clases + membresías + app.' },
  { id: 'artes_marciales', label: 'Box / Artes Marciales', familyId: 'fitness', overpassTags: [{ key: 'leisure', value: 'fitness_centre' }], auditHint: 'Pain frecuente: sin sistema de grados/cinturones digital. Solución Noon: plataforma de alumnos + progreso + pagos.' },
  { id: 'natacion', label: 'Natación / Acuático', familyId: 'fitness', overpassTags: [{ key: 'leisure', value: 'swimming_pool' }], auditHint: 'Pain frecuente: inscripciones manuales, sin horarios online. Solución Noon: sistema de inscripciones + horarios + pagos.' },
  { id: 'cycling', label: 'Cycling / Spinning', familyId: 'fitness', overpassTags: [{ key: 'leisure', value: 'fitness_centre' }], auditHint: 'Pain frecuente: reserva de bicicletas por WhatsApp. Solución Noon: reservas de clases + app + membresías.' },
  { id: 'entrenador', label: 'Entrenador Personal', familyId: 'fitness', overpassTags: [{ key: 'leisure', value: 'fitness_centre' }], auditHint: 'Pain frecuente: sin presencia profesional, clientes por referido. Solución Noon: sitio personal + planes + seguimiento.' },
  { id: 'meditacion', label: 'Centro de Meditación', familyId: 'fitness', overpassTags: [{ key: 'amenity', value: 'community_centre' }], auditHint: 'Pain frecuente: sin reservas para retiros, sin cursos online. Solución Noon: landing + reservas + cursos digitales.' },

  // F5 — Educación & Formación
  { id: 'academia', label: 'Academia / Instituto', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'school' }], auditHint: 'Pain frecuente: inscripciones manuales, sin plataforma de alumnos. Solución Noon: portal de alumnos + pagos + material.' },
  { id: 'idiomas', label: 'Escuela de Idiomas', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'language_school' }], auditHint: 'Pain frecuente: sin clases online, sin niveles digitales. Solución Noon: plataforma de cursos + niveles + certificados.' },
  { id: 'guarderia', label: 'Guardería / Kinder', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'kindergarten' }], auditHint: 'Pain frecuente: sin comunicación digital con padres. Solución Noon: app de padres + reportes diarios + pagos.' },
  { id: 'colegio', label: 'Colegio / Escuela Privada', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'school' }], auditHint: 'Pain frecuente: sin portal de padres, calificaciones en papel. Solución Noon: portal escolar + calificaciones + pagos.' },
  { id: 'tutorias', label: 'Centro de Tutorías', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'school' }], auditHint: 'Pain frecuente: sin agenda online, clases por WhatsApp. Solución Noon: plataforma de tutorías + sesiones + pagos.' },
  { id: 'musica', label: 'Escuela de Música', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'music_school' }], auditHint: 'Pain frecuente: sin inscripciones online, sin seguimiento de alumnos. Solución Noon: portal + clases + recitales.' },
  { id: 'danza', label: 'Escuela de Baile / Danza', familyId: 'educacion', overpassTags: [{ key: 'leisure', value: 'dance' }], auditHint: 'Pain frecuente: sin reservas de clases, sin catálogo de estilos. Solución Noon: landing + clases + inscripciones.' },
  { id: 'arte', label: 'Escuela de Arte / Pintura', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'school' }], auditHint: 'Pain frecuente: sin portafolio digital, talleres por referido. Solución Noon: galería + talleres + inscripciones.' },
  { id: 'autoescuela', label: 'Autoescuela / Manejo', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'driving_school' }], auditHint: 'Pain frecuente: sin simulador digital, pagos en efectivo. Solución Noon: plataforma de clases + pagos + seguimiento.' },
  { id: 'formacion_prof', label: 'Formación Profesional / Cursos', familyId: 'educacion', overpassTags: [{ key: 'amenity', value: 'college' }], auditHint: 'Pain frecuente: sin plataforma LMS, cursos solo presenciales. Solución Noon: plataforma de cursos online + certificados.' },

  // F6 — Servicios Profesionales
  { id: 'abogados', label: 'Despacho de Abogados', familyId: 'profesionales', overpassTags: [{ key: 'office', value: 'lawyer' }], auditHint: 'Pain frecuente: sin presencia digital profesional, clientes por referido. Solución Noon: sitio institucional + consultas online.' },
  { id: 'contabilidad', label: 'Contabilidad / Auditoría', familyId: 'profesionales', overpassTags: [{ key: 'office', value: 'accountant' }], auditHint: 'Pain frecuente: sin portal de clientes, documentos por email. Solución Noon: portal de clientes + documentos + pagos.' },
  { id: 'consultoria', label: 'Consultoría Empresarial', familyId: 'profesionales', overpassTags: [{ key: 'office', value: 'consulting' }], auditHint: 'Pain frecuente: sin portafolio de casos, sin agendar consultas online. Solución Noon: sitio + casos de éxito + agenda.' },
  { id: 'marketing', label: 'Agencia de Marketing / Publicidad', familyId: 'profesionales', overpassTags: [{ key: 'office', value: 'advertising_agency' }], auditHint: 'Pain frecuente: sin portafolio actualizado, sin gestión de proyectos digital. Solución Noon: sitio editorial + portafolio.' },
  { id: 'arquitectura', label: 'Arquitectura / Diseño', familyId: 'profesionales', overpassTags: [{ key: 'office', value: 'architect' }], auditHint: 'Pain frecuente: sin portafolio 3D online, cotizaciones manuales. Solución Noon: sitio editorial + portafolio + cotizador.' },
  { id: 'ingenieria', label: 'Ingeniería', familyId: 'profesionales', overpassTags: [{ key: 'office', value: 'engineer' }], auditHint: 'Pain frecuente: sin presencia digital, proyectos por referido. Solución Noon: sitio institucional + portafolio + contacto.' },
  { id: 'rrhh', label: 'Recursos Humanos / Headhunting', familyId: 'profesionales', overpassTags: [{ key: 'office', value: 'employment_agency' }], auditHint: 'Pain frecuente: sin portal de vacantes, candidatos por email. Solución Noon: portal de empleos + ATS básico.' },
  { id: 'coworking', label: 'Coworking / Oficinas', familyId: 'profesionales', overpassTags: [{ key: 'office', value: 'coworking' }], auditHint: 'Pain frecuente: sin reservas de espacios online, sin membresías digitales. Solución Noon: reservas + membresías + portal.' },

  // F7 — Retail & Comercio
  { id: 'ropa', label: 'Tienda de Ropa / Moda', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'clothes' }], auditHint: 'Pain frecuente: sin tienda online, ventas solo presenciales. Solución Noon: e-commerce + catálogo + envíos.' },
  { id: 'zapateria', label: 'Zapatería', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'shoes' }], auditHint: 'Pain frecuente: sin catálogo digital, sin tallas online. Solución Noon: tienda online + catálogo por talla + envíos.' },
  { id: 'joyeria', label: 'Joyería / Accesorios', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'jewelry' }], auditHint: 'Pain frecuente: sin catálogo visual premium, ventas solo locales. Solución Noon: sitio editorial + tienda + envíos.' },
  { id: 'libreria', label: 'Librería / Papelería', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'books' }], auditHint: 'Pain frecuente: sin catálogo online, sin pedidos a domicilio. Solución Noon: tienda online + catálogo + delivery.' },
  { id: 'electronica', label: 'Electrónica / Gadgets', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'electronics' }], auditHint: 'Pain frecuente: sin tienda online, sin comparador de precios. Solución Noon: e-commerce + catálogo + garantías.' },
  { id: 'ferreteria', label: 'Ferretería / Materiales', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'hardware' }], auditHint: 'Pain frecuente: sin catálogo digital, pedidos por teléfono. Solución Noon: catálogo + cotizador + pedidos online.' },
  { id: 'muebleria', label: 'Mueblería / Decoración', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'furniture' }], auditHint: 'Pain frecuente: sin catálogo 3D, clientes no pueden ver estilos. Solución Noon: catálogo visual + cotizador + tienda.' },
  { id: 'jugueteria', label: 'Juguetería', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'toys' }], auditHint: 'Pain frecuente: sin tienda online, ventas concentradas en temporada. Solución Noon: e-commerce + catálogo + envíos.' },
  { id: 'deportes', label: 'Deportes / Outdoor', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'sports' }], auditHint: 'Pain frecuente: sin catálogo por deporte, sin renta de equipo online. Solución Noon: tienda online + catálogo + renta.' },
  { id: 'tienda_mascotas', label: 'Tienda de Mascotas', familyId: 'retail', overpassTags: [{ key: 'shop', value: 'pet' }], auditHint: 'Pain frecuente: sin e-commerce, pedidos por WhatsApp. Solución Noon: tienda online + suscripción de productos.' },

  // F8 — Automotriz
  { id: 'agencia_autos', label: 'Agencia de Autos', familyId: 'automotriz', overpassTags: [{ key: 'shop', value: 'car' }], auditHint: 'Pain frecuente: sin catálogo digital, prospectos por teléfono. Solución Noon: sitio + catálogo + cotizador + CRM.' },
  { id: 'taller_mecanico', label: 'Taller Mecánico', familyId: 'automotriz', overpassTags: [{ key: 'shop', value: 'car_repair' }], auditHint: 'Pain frecuente: sin citas online, sin seguimiento de reparaciones. Solución Noon: sistema de citas + órdenes + notificaciones.' },
  { id: 'hojalateria', label: 'Hojalatería / Pintura', familyId: 'automotriz', overpassTags: [{ key: 'shop', value: 'car_repair' }], auditHint: 'Pain frecuente: cotizaciones manuales, sin portafolio. Solución Noon: cotizador + galería de trabajos + citas.' },
  { id: 'llantas', label: 'Llantas / Alineación', familyId: 'automotriz', overpassTags: [{ key: 'shop', value: 'tyres' }], auditHint: 'Pain frecuente: sin citas, clientes esperan. Solución Noon: citas online + cotizador + notificaciones.' },
  { id: 'autolavado', label: 'Autolavado', familyId: 'automotriz', overpassTags: [{ key: 'amenity', value: 'car_wash' }], auditHint: 'Pain frecuente: sin reservas, filas largas. Solución Noon: reservas + membresías + fidelización.' },
  { id: 'agencia_motos', label: 'Agencia de Motos', familyId: 'automotriz', overpassTags: [{ key: 'shop', value: 'motorcycle' }], auditHint: 'Pain frecuente: sin catálogo digital, sin financiamiento online. Solución Noon: sitio + catálogo + cotizador.' },
  { id: 'refaccionaria', label: 'Refaccionaria / Autopartes', familyId: 'automotriz', overpassTags: [{ key: 'shop', value: 'car_parts' }], auditHint: 'Pain frecuente: sin catálogo digital, pedidos por teléfono. Solución Noon: catálogo + buscador de piezas + envíos.' },
  { id: 'estacionamiento', label: 'Estacionamiento', familyId: 'automotriz', overpassTags: [{ key: 'amenity', value: 'parking' }], auditHint: 'Pain frecuente: sin reservas anticipadas, sin membresías digitales. Solución Noon: reservas + membresías + pagos.' },

  // F9 — Hoteles & Hospedaje
  { id: 'hotel_boutique', label: 'Hotel Boutique', familyId: 'hospedaje', overpassTags: [{ key: 'tourism', value: 'hotel' }], auditHint: 'Pain frecuente: dependencia de OTAs con comisiones altas. Solución Noon: motor de reservas directo + sitio editorial.' },
  { id: 'hotel_negocios', label: 'Hotel de Negocios', familyId: 'hospedaje', overpassTags: [{ key: 'tourism', value: 'hotel' }], auditHint: 'Pain frecuente: sin gestión de reservas corporativas. Solución Noon: portal corporativo + reservas + facturación.' },
  { id: 'hostel', label: 'Hostel / Mochilero', familyId: 'hospedaje', overpassTags: [{ key: 'tourism', value: 'hostel' }], auditHint: 'Pain frecuente: dependencia de Booking/Hostelworld. Solución Noon: sitio + reservas directas + SEO.' },
  { id: 'motel', label: 'Motel', familyId: 'hospedaje', overpassTags: [{ key: 'tourism', value: 'motel' }], auditHint: 'Pain frecuente: sin presencia digital, sin reservas online. Solución Noon: landing + reservas + pagos.' },
  { id: 'renta_vacacional', label: 'Airbnb / Renta Vacacional', familyId: 'hospedaje', overpassTags: [{ key: 'tourism', value: 'guest_house' }], auditHint: 'Pain frecuente: dependencia de plataformas, sin canal directo. Solución Noon: sitio propio + reservas + pagos directos.' },
  { id: 'hacienda', label: 'Casa de Retiro / Hacienda', familyId: 'hospedaje', overpassTags: [{ key: 'tourism', value: 'hotel' }], auditHint: 'Pain frecuente: sin presencia premium, reservas por teléfono. Solución Noon: sitio editorial + reservas + paquetes.' },
  { id: 'glamping', label: 'Glamping / Ecoturismo', familyId: 'hospedaje', overpassTags: [{ key: 'tourism', value: 'camp_site' }], auditHint: 'Pain frecuente: sin reservas online, difícil de encontrar. Solución Noon: landing + reservas + galería inmersiva.' },

  // F10 — Turismo & Experiencias
  { id: 'agencia_viajes', label: 'Agencia de Viajes', familyId: 'turismo', overpassTags: [{ key: 'shop', value: 'travel_agency' }], auditHint: 'Pain frecuente: cotizaciones manuales, sin paquetes online. Solución Noon: catálogo de paquetes + cotizador + CRM.' },
  { id: 'tour_operadora', label: 'Tour Operadora', familyId: 'turismo', overpassTags: [{ key: 'shop', value: 'travel_agency' }], auditHint: 'Pain frecuente: sin reservas de tours online. Solución Noon: plataforma de tours + reservas + pagos.' },
  { id: 'aventura', label: 'Actividades de Aventura', familyId: 'turismo', overpassTags: [{ key: 'leisure', value: 'sports_centre' }], auditHint: 'Pain frecuente: reservas por WhatsApp, sin waivers digitales. Solución Noon: reservas + pagos + formularios legales.' },
  { id: 'escape_room', label: 'Escape Room', familyId: 'turismo', overpassTags: [{ key: 'leisure', value: 'entertainment_centre' }], auditHint: 'Pain frecuente: reservas por WhatsApp, sin gestión de grupos. Solución Noon: reservas + pagos + gestión de salas.' },
  { id: 'museo_galeria', label: 'Museo / Galería', familyId: 'turismo', overpassTags: [{ key: 'tourism', value: 'museum' }], auditHint: 'Pain frecuente: sin tickets online, sin colección digital. Solución Noon: tickets + colección digital + membresías.' },
  { id: 'centro_cultural', label: 'Centro Cultural', familyId: 'turismo', overpassTags: [{ key: 'amenity', value: 'arts_centre' }], auditHint: 'Pain frecuente: sin agenda de eventos online, sin venta de boletos. Solución Noon: agenda + tickets + membresías.' },
  { id: 'parque_atrac', label: 'Parque de Atracciones', familyId: 'turismo', overpassTags: [{ key: 'leisure', value: 'amusement_park' }], auditHint: 'Pain frecuente: filas, sin compra anticipada. Solución Noon: tickets online + pases + membresías familiares.' },
  { id: 'tour_historico', label: 'Tour Histórico / Arqueológico', familyId: 'turismo', overpassTags: [{ key: 'tourism', value: 'attraction' }], auditHint: 'Pain frecuente: sin reservas, guías sin presencia digital. Solución Noon: landing + reservas + tours virtuales.' },

  // F11 — Eventos & Celebraciones
  { id: 'salon_eventos', label: 'Salón de Eventos', familyId: 'eventos', overpassTags: [{ key: 'amenity', value: 'events_venue' }], auditHint: 'Pain frecuente: cotizaciones manuales, sin disponibilidad online. Solución Noon: sitio + cotizador + calendario.' },
  { id: 'bodas', label: 'Organizadora de Bodas', familyId: 'eventos', overpassTags: [{ key: 'amenity', value: 'events_venue' }], auditHint: 'Pain frecuente: sin portafolio premium, cotizaciones por email. Solución Noon: sitio editorial + portafolio + cotizador.' },
  { id: 'foto_video', label: 'Fotografía / Video', familyId: 'eventos', overpassTags: [{ key: 'office', value: 'photographer' }], auditHint: 'Pain frecuente: sin portafolio actualizado, sin reservas online. Solución Noon: portafolio + reservas + contratos digitales.' },
  { id: 'dj_musica', label: 'DJ / Música en Vivo', familyId: 'eventos', overpassTags: [{ key: 'amenity', value: 'events_venue' }], auditHint: 'Pain frecuente: sin presencia profesional, contratación por referido. Solución Noon: sitio + demos + reservas + contratos.' },
  { id: 'decoracion_ev', label: 'Decoración de Eventos', familyId: 'eventos', overpassTags: [{ key: 'shop', value: 'party' }], auditHint: 'Pain frecuente: sin catálogo visual, cotizaciones manuales. Solución Noon: galería + cotizador + reservas.' },
  { id: 'renta_mobiliario', label: 'Renta de Mobiliario', familyId: 'eventos', overpassTags: [{ key: 'shop', value: 'furniture' }], auditHint: 'Pain frecuente: sin catálogo de disponibilidad, reservas por teléfono. Solución Noon: catálogo + disponibilidad + reservas.' },
  { id: 'pasteleria_bodas', label: 'Pastelería de Bodas', familyId: 'eventos', overpassTags: [{ key: 'shop', value: 'confectionery' }], auditHint: 'Pain frecuente: sin catálogo visual, pedidos por DM. Solución Noon: catálogo + cotizador + pedidos online.' },
  { id: 'animacion', label: 'Animación / Entretenimiento', familyId: 'eventos', overpassTags: [{ key: 'amenity', value: 'events_venue' }], auditHint: 'Pain frecuente: sin presencia digital, contratación por referido. Solución Noon: sitio + servicios + reservas.' },

  // F12 — Inmobiliaria & Construcción
  { id: 'inmobiliaria', label: 'Agencia Inmobiliaria', familyId: 'inmobiliaria', overpassTags: [{ key: 'office', value: 'estate_agent' }], auditHint: 'Pain frecuente: propiedades solo en portales, sin sitio propio. Solución Noon: portal de propiedades + CRM + leads.' },
  { id: 'constructora', label: 'Constructora', familyId: 'inmobiliaria', overpassTags: [{ key: 'office', value: 'construction_company' }], auditHint: 'Pain frecuente: sin portafolio digital, cotizaciones manuales. Solución Noon: sitio + portafolio + cotizador.' },
  { id: 'desarrolladora', label: 'Desarrolladora de Proyectos', familyId: 'inmobiliaria', overpassTags: [{ key: 'office', value: 'estate_agent' }], auditHint: 'Pain frecuente: sin micrositio por proyecto, prospectos por teléfono. Solución Noon: micrositio + CRM + sala de ventas virtual.' },
  { id: 'remodelacion', label: 'Empresa de Remodelación', familyId: 'inmobiliaria', overpassTags: [{ key: 'office', value: 'construction_company' }], auditHint: 'Pain frecuente: sin portafolio de trabajos, cotizaciones manuales. Solución Noon: portafolio + cotizador + antes/después.' },
  { id: 'arquitectura_int', label: 'Arquitectura Interior', familyId: 'inmobiliaria', overpassTags: [{ key: 'office', value: 'architect' }], auditHint: 'Pain frecuente: sin portafolio premium, clientes por referido. Solución Noon: sitio editorial + portafolio + contacto.' },
  { id: 'valuacion', label: 'Valuación de Propiedades', familyId: 'inmobiliaria', overpassTags: [{ key: 'office', value: 'estate_agent' }], auditHint: 'Pain frecuente: sin presencia digital, sin solicitudes online. Solución Noon: landing + formulario + CRM.' },
  { id: 'admin_props', label: 'Administración de Propiedades', familyId: 'inmobiliaria', overpassTags: [{ key: 'office', value: 'property_management' }], auditHint: 'Pain frecuente: comunicación con arrendatarios por WhatsApp. Solución Noon: portal + pagos + solicitudes.' },

  // F13 — Logística & Transporte
  { id: 'mudanzas', label: 'Mudanzas', familyId: 'logistica', overpassTags: [{ key: 'office', value: 'moving_company' }], auditHint: 'Pain frecuente: cotizaciones por teléfono, sin reservas online. Solución Noon: cotizador + reservas + seguimiento.' },
  { id: 'mensajeria', label: 'Mensajería / Paquetería', familyId: 'logistica', overpassTags: [{ key: 'amenity', value: 'post_office' }], auditHint: 'Pain frecuente: sin rastreo digital. Solución Noon: portal + rastreo + notificaciones.' },
  { id: 'transporte_ejec', label: 'Transporte Ejecutivo / Chofer', familyId: 'logistica', overpassTags: [{ key: 'amenity', value: 'taxi' }], auditHint: 'Pain frecuente: reservas por WhatsApp, sin app propia. Solución Noon: app de reservas + pagos + historial.' },
  { id: 'transporte_esc', label: 'Transporte Escolar', familyId: 'logistica', overpassTags: [{ key: 'amenity', value: 'bus_station' }], auditHint: 'Pain frecuente: padres no saben si el camión llegó. Solución Noon: app de rastreo + notificaciones a padres.' },
  { id: 'almacenamiento', label: 'Almacenamiento / Bodega', familyId: 'logistica', overpassTags: [{ key: 'landuse', value: 'warehouse' }], auditHint: 'Pain frecuente: sin gestión digital de espacios, contratos en papel. Solución Noon: portal + disponibilidad + contratos.' },
  { id: 'gruas', label: 'Grúas / Remolques', familyId: 'logistica', overpassTags: [{ key: 'amenity', value: 'vehicle_rescue' }], auditHint: 'Pain frecuente: clientes no los encuentran en urgencias. Solución Noon: landing + solicitud de servicio + rastreo.' },

  // F14 — Mascotas & Veterinaria
  { id: 'veterinaria', label: 'Veterinaria / Clínica Animal', familyId: 'mascotas', overpassTags: [{ key: 'amenity', value: 'veterinary' }], auditHint: 'Pain frecuente: citas por teléfono, sin expediente digital. Solución Noon: citas online + expediente de mascota + recordatorios.' },
  { id: 'grooming', label: 'Peluquería Canina / Grooming', familyId: 'mascotas', overpassTags: [{ key: 'shop', value: 'pet_grooming' }], auditHint: 'Pain frecuente: citas por WhatsApp, sin recordatorios. Solución Noon: citas online + recordatorios + galería de trabajos.' },
  { id: 'hotel_mascotas', label: 'Hotel para Mascotas', familyId: 'mascotas', overpassTags: [{ key: 'amenity', value: 'animal_boarding' }], auditHint: 'Pain frecuente: sin reservas online, dueños no saben cómo está su mascota. Solución Noon: reservas + actualizaciones + fotos.' },
  { id: 'adiestramiento', label: 'Adiestramiento / Entrenamiento', familyId: 'mascotas', overpassTags: [{ key: 'amenity', value: 'animal_training' }], auditHint: 'Pain frecuente: sin portafolio, sin inscripciones online. Solución Noon: landing + portafolio + inscripciones + seguimiento.' },

  // F15 — Hogar & Servicios Domésticos
  { id: 'limpieza_hogar', label: 'Limpieza del Hogar', familyId: 'hogar', overpassTags: [{ key: 'office', value: 'cleaning_company' }], auditHint: 'Pain frecuente: sin reservas online, clientes por referido. Solución Noon: landing + reservas + membresías.' },
  { id: 'jardineria', label: 'Jardinería / Landscaping', familyId: 'hogar', overpassTags: [{ key: 'office', value: 'landscape_architect' }], auditHint: 'Pain frecuente: sin portafolio, cotizaciones manuales. Solución Noon: portafolio + cotizador + agenda de mantenimiento.' },
  { id: 'plomeria', label: 'Plomería', familyId: 'hogar', overpassTags: [{ key: 'craft', value: 'plumber' }], auditHint: 'Pain frecuente: clientes no los encuentran en urgencias. Solución Noon: landing + solicitud de emergencia.' },
  { id: 'electricidad', label: 'Electricidad / Instalaciones', familyId: 'hogar', overpassTags: [{ key: 'craft', value: 'electrician' }], auditHint: 'Pain frecuente: sin presencia digital, sin cotizaciones online. Solución Noon: landing + cotizador + solicitud.' },
  { id: 'pintura_hogar', label: 'Pintura / Acabados', familyId: 'hogar', overpassTags: [{ key: 'craft', value: 'painter' }], auditHint: 'Pain frecuente: sin portafolio, cotizaciones manuales. Solución Noon: galería de trabajos + cotizador + agenda.' },
  { id: 'control_plagas', label: 'Control de Plagas', familyId: 'hogar', overpassTags: [{ key: 'office', value: 'pest_control' }], auditHint: 'Pain frecuente: clientes no los encuentran en urgencias. Solución Noon: landing + solicitud + pagos.' },
  { id: 'seguridad', label: 'Seguridad / Alarmas', familyId: 'hogar', overpassTags: [{ key: 'office', value: 'security' }], auditHint: 'Pain frecuente: sin portal de clientes, monitoreo sin app. Solución Noon: portal + monitoreo + solicitudes.' },
  { id: 'cerrajeria', label: 'Cerrajería', familyId: 'hogar', overpassTags: [{ key: 'craft', value: 'locksmith' }], auditHint: 'Pain frecuente: clientes no los encuentran en urgencias. Solución Noon: landing + solicitud urgente + ubicación.' },

  // F16 — Finanzas & Seguros
  { id: 'asesor_financiero', label: 'Asesor Financiero', familyId: 'finanzas', overpassTags: [{ key: 'office', value: 'financial' }], auditHint: 'Pain frecuente: sin presencia digital profesional, clientes por referido. Solución Noon: sitio + calculadoras + agenda.' },
  { id: 'seguros', label: 'Agente de Seguros', familyId: 'finanzas', overpassTags: [{ key: 'office', value: 'insurance' }], auditHint: 'Pain frecuente: sin cotizador online, propuestas por email. Solución Noon: cotizador + CRM + portal de clientes.' },
  { id: 'empeno', label: 'Casa de Empeño', familyId: 'finanzas', overpassTags: [{ key: 'shop', value: 'pawnbroker' }], auditHint: 'Pain frecuente: sin catálogo de artículos, sin valuación online. Solución Noon: catálogo + cotizador + landing.' },
  { id: 'cambio_divisas', label: 'Cambio de Divisas', familyId: 'finanzas', overpassTags: [{ key: 'amenity', value: 'bureau_de_change' }], auditHint: 'Pain frecuente: clientes no saben el tipo de cambio actual. Solución Noon: landing + tipo de cambio en tiempo real.' },
  { id: 'microfinanciera', label: 'Microfinanciera / Préstamos', familyId: 'finanzas', overpassTags: [{ key: 'office', value: 'financial' }], auditHint: 'Pain frecuente: solicitudes en papel, sin proceso digital. Solución Noon: formulario de solicitud + simulador de préstamo.' },

  // F17 — Medios & Entretenimiento
  { id: 'estudio_grabacion', label: 'Estudio de Grabación / Podcast', familyId: 'medios', overpassTags: [{ key: 'amenity', value: 'studio' }], auditHint: 'Pain frecuente: sin reservas online, sin disponibilidad digital. Solución Noon: reservas + tarifas + portafolio.' },
  { id: 'productora', label: 'Productora de Video / Cine', familyId: 'medios', overpassTags: [{ key: 'office', value: 'production_company' }], auditHint: 'Pain frecuente: sin portafolio actualizado, cotizaciones manuales. Solución Noon: portafolio + showreel + cotizador.' },
  { id: 'estudio_foto', label: 'Estudio de Fotografía', familyId: 'medios', overpassTags: [{ key: 'office', value: 'photographer' }], auditHint: 'Pain frecuente: sin reservas online, portafolio en Instagram. Solución Noon: sitio + portafolio + reservas + contratos.' },
  { id: 'modelos_casting', label: 'Agencia de Modelos / Casting', familyId: 'medios', overpassTags: [{ key: 'office', value: 'model_agency' }], auditHint: 'Pain frecuente: sin portafolio digital de talento, casting por correo. Solución Noon: plataforma de talento + bookings.' },
  { id: 'revista_digital', label: 'Periódico / Revista Digital', familyId: 'medios', overpassTags: [{ key: 'office', value: 'newspaper' }], auditHint: 'Pain frecuente: sin modelo de suscripción. Solución Noon: plataforma editorial + suscripciones + membresías.' },

  // F18 — Organizaciones & Comunidades
  { id: 'iglesia', label: 'Iglesia / Templo', familyId: 'comunidades', overpassTags: [{ key: 'amenity', value: 'place_of_worship' }], auditHint: 'Pain frecuente: sin donaciones online, comunidad sin plataforma. Solución Noon: sitio + donaciones + transmisión + comunidad.' },
  { id: 'ong', label: 'Asociación Civil / ONG', familyId: 'comunidades', overpassTags: [{ key: 'amenity', value: 'community_centre' }], auditHint: 'Pain frecuente: sin donaciones online, sin portal de voluntarios. Solución Noon: sitio + donaciones + voluntariado + impacto.' },
  { id: 'club_deportivo', label: 'Club Deportivo / Asociación', familyId: 'comunidades', overpassTags: [{ key: 'leisure', value: 'sports_club' }], auditHint: 'Pain frecuente: sin portal de socios, cuotas en efectivo. Solución Noon: portal de socios + pagos + agenda de eventos.' },

  // F19 — Industria & Manufactura
  { id: 'manufactura', label: 'Taller de Manufactura', familyId: 'manufactura', overpassTags: [{ key: 'industrial', value: 'factory' }], auditHint: 'Pain frecuente: sin catálogo de productos, cotizaciones manuales. Solución Noon: catálogo + cotizador + portal de clientes.' },
  { id: 'imprenta', label: 'Imprenta / Serigrafía', familyId: 'manufactura', overpassTags: [{ key: 'craft', value: 'printer' }], auditHint: 'Pain frecuente: cotizaciones manuales, pedidos por email. Solución Noon: cotizador online + pedidos + seguimiento.' },
  { id: 'carpinteria', label: 'Carpintería / Ebanistería', familyId: 'manufactura', overpassTags: [{ key: 'craft', value: 'carpenter' }], auditHint: 'Pain frecuente: sin portafolio, cotizaciones manuales. Solución Noon: galería de trabajos + cotizador + agenda.' },
  { id: 'herreria', label: 'Herrería / Soldadura', familyId: 'manufactura', overpassTags: [{ key: 'craft', value: 'metal_construction' }], auditHint: 'Pain frecuente: sin portafolio digital, clientes por referido. Solución Noon: galería + cotizador + contacto.' },
  { id: 'textil', label: 'Textil / Confección', familyId: 'manufactura', overpassTags: [{ key: 'craft', value: 'tailor' }], auditHint: 'Pain frecuente: sin catálogo, pedidos manuales. Solución Noon: catálogo + pedidos + seguimiento de producción.' },
  { id: 'alimentos_prod', label: 'Alimentos & Bebidas (producción)', familyId: 'manufactura', overpassTags: [{ key: 'craft', value: 'food' }], auditHint: 'Pain frecuente: sin e-commerce B2B, pedidos por teléfono. Solución Noon: portal de pedidos + catálogo + distribuidores.' },

  // F20 — Salud & Bienestar Alternativo
  { id: 'acupuntura', label: 'Acupuntura', familyId: 'bienestar_alt', overpassTags: [{ key: 'healthcare', value: 'alternative' }], auditHint: 'Pain frecuente: sin presencia digital, pacientes por referido. Solución Noon: landing + citas + contenido educativo.' },
  { id: 'quiropractica', label: 'Quiropráctica', familyId: 'bienestar_alt', overpassTags: [{ key: 'healthcare', value: 'alternative' }], auditHint: 'Pain frecuente: sin citas online, sin explicación digital del servicio. Solución Noon: landing + citas + contenido educativo.' },
  { id: 'homeopatia', label: 'Homeopatía', familyId: 'bienestar_alt', overpassTags: [{ key: 'healthcare', value: 'alternative' }], auditHint: 'Pain frecuente: desconfianza por falta de información digital. Solución Noon: sitio educativo + citas + casos.' },
  { id: 'medicina_trad', label: 'Medicina Tradicional', familyId: 'bienestar_alt', overpassTags: [{ key: 'healthcare', value: 'alternative' }], auditHint: 'Pain frecuente: sin presencia digital, clientes solo locales. Solución Noon: landing + historia + citas + delivery.' },
  { id: 'terapias_holist', label: 'Terapias Holísticas', familyId: 'bienestar_alt', overpassTags: [{ key: 'healthcare', value: 'alternative' }], auditHint: 'Pain frecuente: sin agenda digital, sin paquetes online. Solución Noon: landing + citas + paquetes + testimonios.' },
]

export function getNicheById(id: string): Niche | undefined {
  return NICHES.find((n) => n.id === id)
}

export function getNichesByFamily(familyId: string): Niche[] {
  return NICHES.filter((n) => n.familyId === familyId)
}

export function getNicheFamily(familyId: string): NicheFamily | undefined {
  return NICHE_FAMILIES.find((f) => f.id === familyId)
}
