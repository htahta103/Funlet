<!-- 4c1b1e27-4a94-486b-a28b-fdb5d0f7531a e20e30e4-347d-41ff-be8e-08c93a13609e -->
# Ansoft Agency Landing Page Specification

## Design Direction

**Visual Style:**

- Modern, professional, tech-forward aesthetic with subtle futuristic elements
- Clean, minimalist design with strategic use of white space
- **Glassmorphism effects** on cards (frosted glass with backdrop blur)
- **Gradient overlays** on sections for depth
- Color scheme: Primary (professional blue/purple gradient), Secondary (vibrant accent colors), Neutral (grays, whites)
- Typography: Modern sans-serif fonts (Inter, Poppins, or similar)
- Smooth animations and transitions throughout
- **Neumorphism** for subtle depth on buttons and inputs
- **Floating elements** with parallax effects

**Layout Pattern:**

- Single-page scroll with smooth navigation
- Sticky header with navigation (blur background on scroll)
- Full-width hero section with animated gradient background
- Alternating content sections with varying backgrounds
- Mobile-first responsive design
- Sections with subtle diagonal cuts or curved transitions

## Page Sections & Content

### 1. Header/Navigation (Sticky)

- Logo: "ANSOFT" or "ANS" branding
- Navigation links: About, Services, Team, Contact
- CTA button: "Start Your Project" (scrolls to contact form)
- Mobile: Hamburger menu

### 2. Hero Section

**Headline:** "Expert Low-Code Solutions with Developer DNA"
**Subheadline:** "We help businesses bring their app ideas to life quickly and affordably. With 6+ years of Flutter experience and expertise in low-code platforms like FlutterFlow and WeWeb, we deliver high-quality apps without the traditional development headaches."

**Stats Banner (subtle, below subheadline):**

- $40K+ Total Earnings
- 418+ Agency Hours
- 95% Job Success
- Top Rated on Upwork

**CTA Buttons:**

- Primary: "Get Started" (scroll to contact)
- Secondary: "View Services" (scroll to services)

**Visual Element:**

- Animated background gradient or geometric patterns
- Optional: Code snippets floating/animating in background
- Hero illustration showing low-code platform logos (FlutterFlow, WeWeb, Xano)

### 3. About Section - "Who We Are"

**Content:**
"Ansoft is a forward-thinking software development company bridging the gap between traditional coding and modern low-code platforms. As certified experts in FlutterFlow, WeWeb, and Xano, we deliver enterprise-grade solutions with the speed and efficiency of low-code development."

**Three Feature Cards:**

1. **Developer DNA**

- Icon: Code symbol
- Text: "Our deep roots in traditional software development mean we don't just build applications—we architect scalable, robust solutions."

2. **Beyond Low-Code Limitations**

- Icon: Rocket/Lightning
- Text: "We unleash the full potential of low-code platforms while retaining the flexibility to extend and customize when needed."

3. **Enterprise-Grade Solutions**

- Icon: Shield/Star
- Text: "Tailored services that meet the unique needs of businesses of all sizes, driving measurable success."

### 4. Services Section

**Headline:** "Our Services"

**Service Categories (6 cards in grid):**

1. **Mobile Development**

- FlutterFlow expertise
- Cross-platform apps
- Offline functionality

2. **Web Development**

- WeWeb, React applications
- Responsive design
- Progressive web apps

3. **AI Apps & Integration**

- AI-powered solutions
- ChatGPT integration
- Intelligent automation

4. **Backend & Database**

- Supabase, Firebase, Xano
- API development
- Real-time features

5. **ERP/CRM Software**

- Custom business solutions
- Workflow automation
- Point of Sale systems

6. **DevOps & Architecture**

- Solution architecture
- Cloud deployment
- CI/CD pipelines

### 5. Technologies Section

**Headline:** "Technologies We Master"

**Tech Stack Display (Icon grid with tooltips):**

- FlutterFlow
- WeWeb
- Xano
- Supabase
- Firebase
- React
- Push Notifications
- Websockets
- Agora.io
- Pega Platform

### 6. Team Section

**Headline:** "Meet Our Team"

**Team Member Cards:**

1. **An H. (Business Manager)**

- 95% Job Success
- Top Rated
- Badge: "Top Rated"

2. **Tran Manh T.**

- 100% Job Success
- Top Rated
- Badge: "Top Rated"

3. **Chan T.**

- Rising Talent
- Badge: "Rising Talent"

4. **Duong B.**

- 83% Job Success
- Badge: "Expert"

### 7. Contact Section

**Headline:** "Ready to Innovate?"
**Subheadline:** "Partner with Ansoft to accelerate your digital transformation with solutions that are fast, scalable, and built to last."

**Contact Form Fields:**

- Name (required)
- Email (required)
- Company (optional)
- Project Type (dropdown):
- Mobile App Development
- Web Application
- AI Integration
- ERP/CRM Solution
- DevOps & Architecture
- Other
- Budget Range (dropdown):
- < $5,000
- $5,000 - $15,000
- $15,000 - $50,000
- $50,000+
- Not sure yet
- Message (required, textarea)
- Submit button: "Send Message"

**Form Behavior:**

- Client-side validation
- Success message on submission
- Error handling
- Optional: Integration with email service or form backend

### 8. Footer

**Content:**

- Logo and tagline
- Quick links: Services, Team, Contact
- Social media icons (LinkedIn, GitHub, Twitter/X)
- Copyright: "© 2025 Ansoft. All rights reserved."
- Email contact: contact@ansoft.com (or actual email)

## Technical Features

**Animations:**

- Fade-in on scroll for sections
- Hover effects on cards and buttons
- Smooth scroll behavior for navigation
- Loading animations for contact form submission

**Responsive Breakpoints:**

- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

**Performance:**

- Lazy loading for images
- Optimized assets
- Fast page load time

**SEO:**

- Meta title: "Ansoft - Expert Low-Code Development Agency"
- Meta description: "Enterprise-grade low-code solutions with developer DNA. Certified experts in FlutterFlow, WeWeb, and Xano."
- Open Graph tags for social sharing
- Proper heading hierarchy

## Color Palette Suggestion

**Primary Colors:**

- Deep Blue: #1E40AF
- Purple: #7C3AED
- Gradient: Linear gradient from blue to purple

**Accent Colors:**

- Bright Green: #10B981 (for success states)
- Orange: #F59E0B (for CTAs)

**Neutral Colors:**

- Dark Gray: #1F2937 (text)
- Light Gray: #F9FAFB (backgrounds)
- White: #FFFFFF

## Assets Needed

- Company logo (SVG preferred)
- Team member photos or avatars
- Service/technology icons
- Background patterns or illustrations
- Favicon

## Implementation Notes for Lovable

1. Start with a clean React component structure
2. Use Tailwind CSS for styling (Lovable supports this well)
3. Implement smooth scroll with React libraries like `react-scroll`
4. Use Framer Motion or similar for animations
5. Form handling: React Hook Form or Formik
6. Consider using EmailJS or similar for contact form backend
7. Deploy on Vercel or Netlify for best performance