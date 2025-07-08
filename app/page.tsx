import React from 'react'
import {Button} from "@/components/ui/button";
import CompanionCard from "@/components/ui/CompanionCard";
import CompanionList from "@/components/ui/CompanionList";
import CTA from "@/components/ui/CTA";
import {recentSessions} from "@/constants";

const Page = () => {
  return (

    <main>
      <h1 className="text-2xl underline">Popular Companions</h1>
      <section className="home-section">
          <CompanionCard
            id="123"
            name="Neura the Brainy Explorer"
            topic="Neural Network of the Brain"
            subject="science"
            duration={45}
            color="#e5d0ff"
          />
          <CompanionCard
            id="124"
            name="Indefinite Integrals"
            topic="Derivatives and Integration"
            subject="Maths"
            duration={60}
            color="#BDE7FF"
          />
          <CompanionCard
            id="125"
            name="verbal Reasoning"
            topic="Language"
            subject="English"
            duration={45}
            color="#ffda6e"
          />

      </section>

        <section className="home-section">
            <CompanionList
                title="Recently completed Sessions"
                companions = {recentSessions}
                classNames="w-2/3 max-lg:w-full"
            />
            <CTA/>
        </section>
    </main>
  )
}

export default Page